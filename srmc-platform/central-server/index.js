/**
 * central-server/index.js — SRMC Central Monitoring Server.
 *
 * Receives periodic stats reports from remote SRMC Desktop installations
 * and stores them for viewing in a dashboard.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT) || 4000;

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// ── Initialize database ───────────────────────────────────────────────

initDb();

// ── API Routes ────────────────────────────────────────────────────────

/**
 * POST /api/stats/report — Receive a stats report from a remote installation.
 */
app.post('/api/stats/report', (req, res) => {
  try {
    const {
      install_id, org_name, timestamp, uptime,
      messages_sent_today, messages_sent_total, messages_failed, messages_pending,
      gateways_online, gateways_total,
      users_total,
      broadcasts_active, broadcasts_total,
      inbound_total, inbound_unread,
      ngrok_running, ngrok_url,
      hostname, platform, arch, cpus, total_mem, node_ver, app_ver,
    } = req.body;

    if (!install_id) {
      return res.status(400).json({ success: false, error: 'install_id is required' });
    }

    // Upsert the installation
    db.prepare(`
      INSERT OR REPLACE INTO installations (
        install_id, org_name, hostname, platform, arch, cpus, total_mem,
        node_ver, app_ver, ngrok_url, ngrok_running,
        last_seen, first_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 
        COALESCE((SELECT first_seen FROM installations WHERE install_id = ?), datetime('now')))
    `).run(
      install_id, org_name || '', hostname || '', platform || '', arch || '',
      cpus || 0, total_mem || '', node_ver || '', app_ver || '',
      ngrok_url || '', ngrok_running ? 1 : 0,
      install_id
    );

    // Insert the stats snapshot
    const snapshotId = crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });

    db.prepare(`
      INSERT INTO stats_snapshots (
        id, install_id, timestamp, uptime,
        messages_sent_today, messages_sent_total, messages_failed, messages_pending,
        gateways_online, gateways_total,
        users_total,
        broadcasts_active, broadcasts_total,
        inbound_total, inbound_unread
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId, install_id, timestamp || new Date().toISOString(), uptime || '',
      messages_sent_today || 0, messages_sent_total || 0, messages_failed || 0, messages_pending || 0,
      gateways_online || 0, gateways_total || 0,
      users_total || 0,
      broadcasts_active || 0, broadcasts_total || 0,
      inbound_total || 0, inbound_unread || 0
    );

    // Update last stats on the installation record
    db.prepare(`
      UPDATE installations SET
        messages_sent_today = ?, messages_sent_total = ?, messages_failed = ?,
        gateways_online = ?, last_seen = datetime('now')
      WHERE install_id = ?
    `).run(
      messages_sent_today || 0, messages_sent_total || 0, messages_failed || 0,
      gateways_online || 0, install_id
    );

    console.log(`[central] 📊 Report from ${org_name || hostname || install_id} — ${messages_sent_today || 0} sent today`);

    return res.json({ success: true, message: 'Report received' });
  } catch (e) {
    console.error('[central] Error processing report:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/installations — List all known installations.
 */
app.get('/api/installations', (req, res) => {
  try {
    const installations = db.prepare('SELECT * FROM installations ORDER BY last_seen DESC').all();
    return res.json({ success: true, installations });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/installations/:id/stats — Get stats history for a specific installation.
 */
app.get('/api/installations/:id/stats', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const stats = db.prepare(
      'SELECT * FROM stats_snapshots WHERE install_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(req.params.id, limit);
    return res.json({ success: true, stats });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dashboard — Aggregated dashboard data.
 */
app.get('/api/dashboard', (req, res) => {
  try {
    const totalInstallations = db.prepare('SELECT COUNT(*) as c FROM installations').get();
    const onlineInstallations = db.prepare(
      "SELECT COUNT(*) as c FROM installations WHERE last_seen > datetime('now', '-10 minutes')"
    ).get();
    const totalSent = db.prepare('SELECT COALESCE(SUM(messages_sent_total), 0) as c FROM installations').get();
    const totalSentToday = db.prepare('SELECT COALESCE(SUM(messages_sent_today), 0) as c FROM installations').get();

    return res.json({
      success: true,
      total_installations: totalInstallations ? totalInstallations.c : 0,
      online_installations: onlineInstallations ? onlineInstallations.c : 0,
      total_messages_sent: totalSent ? totalSent.c : 0,
      total_messages_today: totalSentToday ? totalSentToday.c : 0,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── Dashboard HTML ─────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SRMC Central Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; color: #f1f5f9; }
    .sub { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; }
    .stat-card .num { font-size: 28px; font-weight: 700; color: #38bdf8; }
    .stat-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #0f172a; border-bottom: 1px solid #334155; }
    td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #1e293b; }
    tr:hover td { background: #334155; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.online { background: #065f46; color: #6ee7b7; }
    .badge.offline { background: #451a03; color: #fcd34d; }
    .refresh { display: inline-block; padding: 6px 16px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer; font-size: 12px; margin-bottom: 16px; }
    .refresh:hover { background: #334155; }
    .empty { text-align: center; padding: 40px; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SRMC Central Monitor</h1>
    <div class="sub">Live status of all remote SRMC Desktop installations</div>
    
    <div class="stats-row" id="summary"></div>
    
    <button class="refresh" onclick="load()">↻ Refresh</button>
    <div id="table-container"></div>
  </div>

  <script>
    async function load() {
      try {
        const [dashRes, instRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/installations')
        ]);
        const dash = await dashRes.json();
        const inst = await instRes.json();
        
        // Summary cards
        document.getElementById('summary').innerHTML = \`
          <div class="stat-card"><div class="num">\${dash.total_installations}</div><div class="label">Total Installations</div></div>
          <div class="stat-card"><div class="num">\${dash.online_installations}</div><div class="label">Online Now</div></div>
          <div class="stat-card"><div class="num">\${Number(dash.total_messages_today).toLocaleString()}</div><div class="label">Messages Today</div></div>
          <div class="stat-card"><div class="num">\${Number(dash.total_messages_sent).toLocaleString()}</div><div class="label">All-Time Messages</div></div>
        \`;
        
        // Table
        if (!inst.installations || inst.installations.length === 0) {
          document.getElementById('table-container').innerHTML = '<div class="empty">No installations have reported yet. Waiting for the first stats ping…</div>';
          return;
        }
        
        const rows = inst.installations.map(i => {
          const isOnline = new Date(i.last_seen) > new Date(Date.now() - 10 * 60 * 1000);
          return \`<tr>
            <td><strong>\${i.org_name || '—'}</strong><br><span style="font-size:11px;color:#64748b">\${i.hostname || ''}</span></td>
            <td><span class="badge \${isOnline ? 'online' : 'offline'}">\${isOnline ? '● Online' : '○ Offline'}</span></td>
            <td>\${i.messages_sent_today || 0}</td>
            <td>\${i.messages_sent_total || 0}</td>
            <td>\${i.gateways_online || 0} / \${i.total_gateways || 0}</td>
            <td style="font-size:11px;color:#64748b">\${i.last_seen ? new Date(i.last_seen).toLocaleString() : '—'}</td>
            <td style="font-size:11px;color:#64748b;font-family:monospace">\${i.ngrok_url ? '✓' : '—'}</td>
          </tr>\`;
        });
        
        document.getElementById('table-container').innerHTML = \`
          <table>
            <thead><tr>
              <th>Installation</th>
              <th>Status</th>
              <th>Today</th>
              <th>Total</th>
              <th>Gateways</th>
              <th>Last Seen</th>
              <th>Ngrok</th>
            </tr></thead>
            <tbody>\${rows.join('')}</tbody>
          </table>
        \`;
      } catch (e) {
        document.getElementById('table-container').innerHTML = '<div class="empty">Error loading data: ' + e.message + '</div>';
      }
    }
    
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`[central] SRMC Central Monitor running on http://localhost:${PORT}`);
  console.log(`[central] Dashboard: http://localhost:${PORT}/`);
  console.log(`[central] Stats API: POST http://localhost:${PORT}/api/stats/report`);
});

/**
 * central-server/index.js — SRMC Central Monitoring Server.
 *
 * Receives periodic stats reports from remote SRMC Desktop installations
 * and stores them for viewing in a dashboard.
 *
 * Authentication:
 *   Set CENTRAL_API_KEY env var to enable auth on dashboard/API routes.
 *   POST /api/stats/report is always open (stats reporter needs no auth).
 *   If CENTRAL_API_KEY is not set, auth is disabled (backwards compatible).
 */
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORT = parseInt(process.env.CENTRAL_SERVER_PORT) || 4000;

// Optional API key — if set, dashboard routes require it
const API_KEY = process.env.CENTRAL_API_KEY || '';
const AUTH_ENABLED = !!API_KEY;

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// ── Initialize database ───────────────────────────────────────────────

initDb();

// ── Auth middleware for dashboard-facing API routes ────────────────────
// Stats report endpoint is exempt — the desktop app needs to push without auth.

function authRequired(req, res, next) {
  if (!AUTH_ENABLED) return next(); // Auth disabled — allow all
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Provide x-api-key header or set CENTRAL_API_KEY.' });
  }
  next();
}

// ── API Routes ────────────────────────────────────────────────────────

/**
 * POST /api/stats/report — Receive a stats report from a remote installation.
 * No auth required — the stats reporter on remote machines posts without a key.
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
 * GET /api/installations — List all known installations (auth required).
 */
app.get('/api/installations', authRequired, (req, res) => {
  try {
    const installations = db.prepare('SELECT * FROM installations ORDER BY last_seen DESC').all();
    return res.json({ success: true, installations });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/installations/:id/stats — Get stats history for a specific installation (auth required).
 */
app.get('/api/installations/:id/stats', authRequired, (req, res) => {
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
 * GET /api/dashboard — Aggregated dashboard data (auth required).
 */
app.get('/api/dashboard', authRequired, (req, res) => {
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

// ── Auth status endpoint (used by dashboard to check if logged in) ────

app.get('/api/auth/status', (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ success: true, auth_enabled: false, authenticated: true });
  }
  const provided = req.headers['x-api-key'];
  const ok = provided && provided === API_KEY;
  return res.json({ success: true, auth_enabled: true, authenticated: !!ok });
});

// ── Login page ──────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SRMC Central Monitor — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #1e293b; border: 1px solid #334155; border-radius: 14px;
      padding: 40px; width: 100%; max-width: 400px; text-align: center;
    }
    .logo {
      width: 48px; height: 48px; border-radius: 12px;
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px; font-size: 20px; font-weight: 700; color: #fff;
    }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #f1f5f9; }
    .sub { font-size: 13px; color: #64748b; margin-bottom: 28px; }
    input {
      width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #334155;
      background: #0f172a; color: #e2e8f0; font-size: 14px; margin-bottom: 16px;
      outline: none; transition: border-color 0.2s;
    }
    input:focus { border-color: #3b82f6; }
    input::placeholder { color: #475569; }
    button {
      width: 100%; padding: 12px; border-radius: 8px; border: none;
      background: #3b82f6; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    button:hover { background: #2563eb; }
    .error { color: #f87171; font-size: 13px; margin-bottom: 12px; display: none; }
    .hint { font-size: 11px; color: #475569; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">S</div>
    <h1>Central Monitor</h1>
    <div class="sub">Enter your API key to access the dashboard</div>
    <div class="error" id="error">Invalid API key</div>
    <input type="password" id="keyInput" placeholder="Enter API key" autofocus
      onkeydown="if(event.key==='Enter') login()" />
    <button onclick="login()">Sign In</button>
    <div class="hint">Set CENTRAL_API_KEY env var on the server to enable authentication.</div>
  </div>
  <script>
    function login() {
      const key = document.getElementById('keyInput').value.trim();
      if (!key) return;
      // Test the key against the API
      fetch('/api/auth/status', { headers: { 'x-api-key': key } })
        .then(r => r.json())
        .then(d => {
          if (d.authenticated) {
            localStorage.setItem('central_api_key', key);
            window.location.href = '/';
          } else {
            document.getElementById('error').style.display = 'block';
          }
        })
        .catch(() => {
          document.getElementById('error').textContent = 'Could not reach server';
          document.getElementById('error').style.display = 'block';
        });
    }
    // If already have a key stored, try it and redirect
    const stored = localStorage.getItem('central_api_key');
    if (stored) {
      fetch('/api/auth/status', { headers: { 'x-api-key': stored } })
        .then(r => r.json())
        .then(d => { if (d.authenticated) window.location.href = '/'; })
        .catch(() => {});
    }
  </script>
</body>
</html>
  `);
});

// ── Dashboard HTML ─────────────────────────────────────────────────────

app.get('/', (req, res) => {
  // If auth is enabled, serve the auth-checking dashboard
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
    .header-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    h1 { font-size: 24px; font-weight: 700; color: #f1f5f9; }
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
    .logout-btn { padding: 6px 14px; background: transparent; border: 1px solid #475569; border-radius: 6px; color: #94a3b8; cursor: pointer; font-size: 11px; }
    .logout-btn:hover { background: #1e293b; color: #f87171; border-color: #f87171; }
    .auth-badge { font-size: 11px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <h1>SRMC Central Monitor</h1>
      <div id="auth-area"></div>
    </div>
    <div class="sub">Live status of all remote SRMC Desktop installations</div>
    
    <div class="stats-row" id="summary"></div>
    
    <button class="refresh" onclick="load()">↻ Refresh</button>
    <div id="table-container"></div>
  </div>

  <script>
    // ── Auth helpers ─────────────────────────────────────────────
    const AUTH_ENABLED = ${AUTH_ENABLED ? 'true' : 'false'};
    const AUTH_KEY = localStorage.getItem('central_api_key');

    function apiHeaders() {
      const h = { 'Content-Type': 'application/json' };
      if (AUTH_ENABLED && AUTH_KEY) h['x-api-key'] = AUTH_KEY;
      return h;
    }

    // If auth is enabled but no key stored, redirect to login
    if (AUTH_ENABLED && !AUTH_KEY) {
      window.location.href = '/login';
    }

    function logout() {
      localStorage.removeItem('central_api_key');
      window.location.href = '/login';
    }

    // Render auth area in header
    function renderAuth() {
      const el = document.getElementById('auth-area');
      if (!AUTH_ENABLED) {
        el.innerHTML = '<span class="auth-badge">🔓 Auth disabled</span>';
        return;
      }
      el.innerHTML = '<span class="auth-badge">🔒 Authenticated</span> <button class="logout-btn" onclick="logout()" style="margin-left:10px">Sign Out</button>';
    }
    renderAuth();

    // ── Dashboard ────────────────────────────────────────────────
    async function load() {
      try {
        const [dashRes, instRes] = await Promise.all([
          fetch('/api/dashboard', { headers: apiHeaders() }),
          fetch('/api/installations', { headers: apiHeaders() })
        ]);

        // If 401, redirect to login
        if (dashRes.status === 401 || instRes.status === 401) {
          localStorage.removeItem('central_api_key');
          window.location.href = '/login';
          return;
        }

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
  if (AUTH_ENABLED) {
    console.log(`[central] 🔒 Authentication enabled — set CENTRAL_API_KEY to secure the dashboard`);
  } else {
    console.log(`[central] 🔓 Authentication disabled — set CENTRAL_API_KEY env var to enable`);
  }
});

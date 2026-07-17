/**
 * server/app.js — Express app factory. Sets up all middleware, routes, and
 * database initialisation but does NOT start listening.
 *
 * This is used by both:
 *   - server/index.js   (CLI / standalone mode)
 *   - electron/main.js  (Electron desktop mode)
 *
 * After obtaining the app, the caller must:
 *   1. import { initWss } from './ws.js'
 *   2. import { startPoller } from './gateway-poller.js'
 *   3. create httpServer, initWss(server), server.listen()
 */

// Force a usable fallback timezone before the DB is initialised.
// initTimezone() (called after initDb()) will read the configured value
// from settings and update this env var accordingly.
process.env.TZ = 'Asia/Manila';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import os from 'os';
import { statSync } from 'fs';
import { createSocket } from 'dgram';
import { fileURLToPath } from 'url';
import { initDb, DB_PATH } from './database/db.js';
import db from './database/db.js';
import { startNgrok, stopNgrok, getNgrokStatus, getNgrokUrl, getNgrokAuthtoken, hasAuthtoken } from './services/ngrok-tunnel.js';
import { getSetting } from './services/config-service.js';
import { authMiddleware, adminOnly } from './middleware/auth.js';
import { loginLimiter, broadcastLimiter, webhookLimiter, gatewayOutboundLimiter, ngrokLimiter } from './middleware/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import authRoutes from './routes/auth.js';
import gatewayAuthRoutes from './routes/gateway-auth.js';
import gatewayOutboundRoutes from './routes/gateway-outbound.js';
import gatewayRoutes from './routes/gateways.js';
import templateRoutes from './routes/templates.js';
import broadcastRoutes from './routes/broadcasts.js';
import campaignRoutes from './routes/campaigns.js';
import agentRoutes from './routes/agents.js';
import inboundRoutes from './routes/inbound.js';
import statsRoutes from './routes/stats.js';
import activityRoutes from './routes/activity.js';
import settingsRoutes from './routes/settings.js';
import contactRoutes from './routes/contacts.js';
import { initTimezone } from './services/timezone.js';

// Read SERVER_PORT from env. Falls back to 3001.
// Server always binds to 0.0.0.0 so both LAN (192.168.x.x) and localhost
// can reach it — this is required for ngrok (which connects to localhost).
// SERVER_HOST is read separately for URL generation in the desktop app.
function resolveServerConfig() {
  const port = parseInt(process.env.SERVER_PORT) || 3003;
  return { host: '0.0.0.0', port };
}

const { host: HOST, port: PORT } = resolveServerConfig();
export { HOST, PORT };
// Ngrok config is read from the database settings table.
// Use getNgrokUrl() / getNgrokAuthtoken() / hasAuthtoken() from ngrok-tunnel.js.
// Static exports kept for backward compat but are always empty —
// consumers should use the ngrok-tunnel.js helpers instead.
export const NGROK_URL = '';
export const NGROK_AUTHTOKEN = '';


const app = express();

app.use(compression()); // Gzip all responses (154KB vendor chunk → ~50KB)
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Trust nginx reverse proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
// so Express sees the real client IP instead of nginx's IP.
// Set to 1 (single proxy hop) instead of true so express-rate-limit
// can correctly identify the client IP for rate limiting.
// This is needed when running behind nginx (both local and Docker).
app.set('trust proxy', 1);

// ── Routes ────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api', gatewayAuthRoutes);
app.use('/api', gatewayOutboundRoutes);
app.use('/api/gateways', gatewayRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/broadcasts', broadcastRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api', statsRoutes); // backward compat: Android ServerStatsPoller calls /api/status and /api/user/stats/:userId
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', contactRoutes);


// ── Serve React client (built files) ────────────────────────────────

const clientDist = path.join(__dirname, '..', '..', 'packages', 'client', 'dist');
// Cache built assets (JS/CSS/images) forever — their filenames include content hashes.
// Don't cache index.html since it might change between builds.
app.use(express.static(clientDist, {
  maxAge: '1y',
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/ws')) return next();
  if (req.path === '/health') return next();
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Ngrok management (admin-only) ────────────────────────────────────

app.get('/api/ngrok/status', authMiddleware, (req, res) => {
  const status = getNgrokStatus();
  const savedUrl = getSetting('public_url');
  return res.json({ success: true, ...status, saved_url: savedUrl || '' });
});

app.post('/api/ngrok/start', ngrokLimiter, authMiddleware, adminOnly, async (req, res) => {
  try {
    // No explicit token — startNgrok resolves this device's own token/domain
    // from settings (set in the Settings page), falling back to env.
    const result = await startNgrok(PORT);
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/ngrok/stop', ngrokLimiter, authMiddleware, adminOnly, async (req, res) => {
  try {
    await stopNgrok();
    return res.json({ success: true, message: 'Tunnel closed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.use('/api', inboundRoutes);

// ── Server LAN address (so Android gateways can be pointed at this PC) ──
// Shown in the Gateway tab so the operator doesn't need to run ipconfig.

function listLanIps() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      // Node <18 uses family 'IPv4'; >=18 may use the number 4.
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (isV4 && !a.internal) out.push({ iface, ip: a.address });
    }
  }
  return out;
}

// Ask the OS which local IP it would use to reach the internet — that's the
// adapter the gateway is almost certainly on. No packets are actually sent.
function primaryLanIp() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ip) => { if (!done) { done = true; resolve(ip || null); } };
    try {
      const s = createSocket('udp4');
      s.once('error', () => { try { s.close(); } catch { } finish(null); });
      s.connect(80, '8.8.8.8', () => {
        let ip = null;
        try { ip = s.address().address; } catch { }
        try { s.close(); } catch { }
        finish(ip);
      });
      setTimeout(() => finish(null), 600);
    } catch { finish(null); }
  });
}

app.get('/api/server-info', authMiddleware, async (req, res) => {
  const addresses = listLanIps();
  let primary = await primaryLanIp();
  if (!primary && addresses.length) primary = addresses[0].ip;
  const url = (ip) => `http://${ip}:${PORT}`;
  return res.json({
    success: true,
    port: PORT,
    primary_ip: primary || '',
    primary_url: primary ? url(primary) : '',
    addresses: addresses.map(a => ({ ...a, url: url(a.ip) })),
  });
});

// ── Connectivity status (online/offline detection for the UI) ──────────

async function checkInternet() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://clients3.google.com/generate_204', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

app.get('/api/server/connectivity', authMiddleware, async (req, res) => {
  const tunnelStatus = getNgrokStatus();
  const addresses = listLanIps();
  let primaryIp = await primaryLanIp();
  if (!primaryIp && addresses.length) primaryIp = addresses[0].ip;
  const ngrokUrl = getNgrokUrl();
  const hasNgrokConfig = !!ngrokUrl || hasAuthtoken();

  const online = hasNgrokConfig ? await checkInternet() : true;

  return res.json({
    success: true,
    online,
    lan: {
      primary_ip: primaryIp || '',
      primary_url: primaryIp ? `http://${primaryIp}:${PORT}` : '',
      addresses: addresses.map(a => ({ ip: a.ip, iface: a.iface, url: `http://${a.ip}:${PORT}` })),
    },
    ngrok: {
      running: tunnelStatus.running,
      url: tunnelStatus.url || '',
      webhook_url: tunnelStatus.webhookUrl || '',
      configured: hasNgrokConfig,
    },

  });
});

// ── System health (consolidated status for the sidebar widget) ──────
// This endpoint is polled by the frontend sidebar widget on navigation
// and on a timer. Cache the result for 2 seconds to avoid hammering the DB.

let _healthCache = { data: null, ts: 0 };
const HEALTH_TTL = 2000;

app.get('/api/system/health', authMiddleware, (req, res) => {
  try {
    const now = Date.now();
    if (_healthCache.data && (now - _healthCache.ts) < HEALTH_TTL) {
      return res.json({ success: true, ..._healthCache.data });
    }

    const sentToday = db.prepare('SELECT COALESCE(SUM(sent_today), 0) AS c FROM gateways').get();
    const dailyCap = parseInt(getSetting('daily_cap')) || 100000;

    const gwCounts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'online' AND active = 1 THEN 1 ELSE 0 END) AS online,
        SUM(CASE WHEN status = 'slow' AND active = 1 THEN 1 ELSE 0 END) AS slow,
        SUM(CASE WHEN status = 'offline' AND active = 1 THEN 1 ELSE 0 END) AS offline,
        SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) AS inactive
      FROM gateways
    `).get();

    const activeBc = db.prepare(
      "SELECT COUNT(*) AS c FROM broadcasts WHERE status IN ('sending', 'paused')"
    ).get();

    let dbSize = 0;
    try { dbSize = statSync(DB_PATH).size; } catch (_) { }

    const data = {
      sent_today: sentToday?.c || 0,
      daily_cap: dailyCap,
      gateways: {
        total: gwCounts?.total || 0,
        online: gwCounts?.online || 0,
        slow: gwCounts?.slow || 0,
        offline: gwCounts?.offline || 0,
        inactive: gwCounts?.inactive || 0,
      },
      active_broadcasts: activeBc?.c || 0,
      db_size: dbSize,
    };

    _healthCache = { data, ts: now };
    return res.json({ success: true, ...data });
  } catch (e) {
    console.error('[system] health error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Simple health check ───────────────────────────────────────────────

app.get('/health', (req, res) => {
  const tunnelStatus = getNgrokStatus();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    port: PORT,
    ngrok: tunnelStatus.running ? tunnelStatus.url : (getNgrokUrl() || 'not configured'),
  });
});

// ── 404 + global error handler (must be after all routes) ───────────
// Unmatched API requests return JSON, not the SPA shell.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ success: false, error: 'Internal server error' });
});

// ── Init DB, timezone, and ngrok (no listen — caller handles that) ──

initDb();
initTimezone();


// The ngrok tunnel is auto-started by apps/web/index.js after the server
// begins listening. The ngrok_url setting is only updated when the tunnel
// actually starts — never restored from a stale previous session URL.
// This prevents the Android app from getting a dead URL during startup.
const token = getNgrokAuthtoken();
if (token) {
  console.log('[ngrok] Auth token found — will auto-start tunnel after server is ready');
}

export default app;

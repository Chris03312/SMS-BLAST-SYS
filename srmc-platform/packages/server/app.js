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

// Force default timezone (Philippines / UTC+8). The actual configurable
// timezone is read dynamically from settings in broadcast-engine.js.
// This env var is the fallback for all server-side Date operations.
process.env.TZ = 'Asia/Manila';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { createSocket } from 'dgram';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import db from './db.js';
import { registerNgrokWebhook } from './services/gateway-service.js';
import { startNgrok, stopNgrok, getNgrokStatus } from './ngrok-tunnel.js';
import { authMiddleware, adminOnly } from './middleware/auth.js';

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

export const PORT    = parseInt(process.env.PORT) || 3001;
export const NGROK_URL       = process.env.NGROK_URL       || '';
export const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN || process.env.NGROK_TOKEN || '';


const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Trust nginx reverse proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
// so Express sees the real client IP instead of nginx's IP.
// This is needed when running behind nginx (both local and Docker).
app.set('trust proxy', true);

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
app.use('/api', statsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);


// ── Serve React client (built files) ────────────────────────────────

const clientDist = path.join(__dirname, '..', '..', 'packages', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/ws'))    return next();
  if (req.path === '/health')        return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Ngrok management (admin-only) ────────────────────────────────────

app.get('/api/ngrok/status', authMiddleware, (req, res) => {
  const status = getNgrokStatus();
  const savedUrl = db.prepare("SELECT value FROM settings WHERE key = 'public_url'").get();
  return res.json({ success: true, ...status, saved_url: savedUrl ? savedUrl.value : '' });
});

app.post('/api/ngrok/start', authMiddleware, adminOnly, async (req, res) => {
  try {
    // No explicit token — startNgrok resolves this device's own token/domain
    // from settings (set in the Settings page), falling back to env.
    const result = await startNgrok(PORT);
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/ngrok/stop', authMiddleware, adminOnly, async (req, res) => {
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
      s.once('error', () => { try { s.close(); } catch {} finish(null); });
      s.connect(80, '8.8.8.8', () => {
        let ip = null;
        try { ip = s.address().address; } catch {}
        try { s.close(); } catch {}
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
  const hasNgrokConfig = !!NGROK_URL || !!NGROK_AUTHTOKEN;

  if (hasNgrokConfig) {
    online = await checkInternet();
  }

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

// ── Health check ──────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const tunnelStatus = getNgrokStatus();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    port: PORT,
    ngrok: tunnelStatus.running ? tunnelStatus.url : (NGROK_URL || 'not configured'),
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

// ── Init DB and ngrok (no listen — caller handles that) ──────────────

initDb();


if (NGROK_URL) {
  registerNgrokWebhook(NGROK_URL);
}

if (!NGROK_URL && NGROK_AUTHTOKEN) {
  console.log('[ngrok] Auth token found — will auto-start tunnel after server is ready');
}

export default app;

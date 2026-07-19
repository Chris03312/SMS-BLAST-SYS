/**
 * apps/web/index.js — Standalone web server entry point (Docker-friendly).
 *
 * Starts the Express server, WebSocket, gateway poller, ngrok tunnel,
 * and stats reporter. This is the Docker-deployable version of the
 * SMS Platform (no Electron dependency).
 *
 * Usage:
 *   node apps/web/index.js
 */

import { createServer } from 'http';
import { initWss } from '@srmc/server/ws.js';
import { startPoller } from '@srmc/server/gateway-poller.js';
import { startNgrok, startNgrokAutoRetry, hasAuthtoken } from '@srmc/server/ngrok-tunnel.js';
import db from '@srmc/server/db.js';
import app, { HOST, PORT, getNgrokUrl } from '@srmc/server/app.js';

const server = createServer(app);

// WebSocket
initWss(server);

server.listen(PORT, HOST, async () => {
  console.log(`[server] SMS Platform running on http://${HOST}:${PORT}`);

  const serverNgrokUrl = getNgrokUrl();

  if (serverNgrokUrl) {
    console.log(`[server] Ngrok webhook URL: ${serverNgrokUrl}/api/webhook/inbound`);
  } else if (hasAuthtoken()) {
    console.log('[ngrok] Auto-starting this device\'s own tunnel…');
    try {
      const tunnel = await startNgrok(PORT);
      console.log(`[ngrok] ✅ Public URL: ${tunnel.url}`);
    } catch (err) {
      console.error('[ngrok] ❌ Auto-start failed:', err.message);
      console.log('[ngrok] Will keep retrying in background…');
      startNgrokAutoRetry(PORT);
    }
  } else {
    console.log('[ngrok] No auth token — add one in Settings to enable inbound tunneling');
  }

  startPoller();
});

// ── Graceful shutdown ────────────────────────────────────────────────
// better-sqlite3 writes directly to disk, so no explicit flush is needed.

function handleShutdown(signal) {
  console.log(`[server] Received ${signal} — shutting down…`);
  try { db.close(); } catch (e) { console.error('[server] Close error:', e.message); }
  server.close(() => {
    console.log('[server] Server closed');
    process.exit(0);
  });
  // Force exit if graceful close takes too long
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT',  () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export default app;

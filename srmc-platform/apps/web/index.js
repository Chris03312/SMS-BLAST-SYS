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
import { startNgrok, startNgrokAutoRetry, hasAuthtoken, getNgrokUrl } from '@srmc/server/ngrok-tunnel.js';
import { flushDb } from '@srmc/server/db.js';
import app, { HOST, PORT } from '@srmc/server/app.js';

const server = createServer(app);

// WebSocket
initWss(server);

server.listen(PORT, HOST, async () => {
  console.log(`[server] SMS Platform running on http://${HOST}:${PORT}`);

  // Read ngrok config from database settings (configured via Settings → Webhooks & API)
  const ngrokUrl = getNgrokUrl();

  if (ngrokUrl) {
    console.log(`[server] Ngrok webhook URL: ${ngrokUrl}/api/webhook/inbound`);
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
// Flush the SQLite database to disk before exiting so no data is lost.

function handleShutdown(signal) {
  console.log(`[server] Received ${signal} — flushing DB and shutting down…`);
  try { flushDb(); } catch (e) { console.error('[server] Flush error:', e.message); }
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

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
import app, { PORT, NGROK_URL, NGROK_AUTHTOKEN } from '@srmc/server/app.js';

const server = createServer(app);

// WebSocket
initWss(server);

server.listen(PORT, async () => {
  console.log(`[server] SMS Platform running on http://localhost:${PORT}`);

  if (NGROK_URL) {
    console.log(`[server] Ngrok webhook URL: ${NGROK_URL}/api/webhook/inbound`);
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
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

export default app;

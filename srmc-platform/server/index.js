/**
 * server/index.js — CLI / standalone entry point.
 *
 * Imports the Express app from app.js, creates the http server, attaches
 * WebSocket, and starts listening. This is used when running via:
 *   npm start   or   node server/index.js
 *
 * For Electron, see electron/main.js which uses app.js directly.
 */

import { createServer } from 'http';
import { initWss } from './ws.js';
import { startPoller } from './gateway-poller.js';
import { startNgrok, startNgrokAutoRetry, hasAuthtoken } from './ngrok-tunnel.js';
import { startStatsReporter, stopStatsReporter } from './stats-reporter.js';
import app, { PORT, NGROK_URL, NGROK_AUTHTOKEN } from './app.js';

const server = createServer(app);

// WebSocket
initWss(server);

server.listen(PORT, async () => {
  console.log(`[server] SRMC Platform running on http://localhost:${PORT}`);

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
  startStatsReporter();
});

// ── Graceful shutdown ────────────────────────────────────────────────
process.on('SIGINT',  () => { stopStatsReporter(); process.exit(0); });
process.on('SIGTERM', () => { stopStatsReporter(); process.exit(0); });

export default app;

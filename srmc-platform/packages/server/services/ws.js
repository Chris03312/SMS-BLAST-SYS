import { WebSocketServer } from 'ws';

let wss = null;
let heartbeatTimer = null;
let connectedClients = 0;

const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export function initWss(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    // Identify client from query param (e.g. from the browser)
    const clientId = new URL(request.url, `http://${request.headers.host}`).searchParams.get('clientId') || 'unknown';
    ws.clientId = clientId;
    ws.isAlive = true;

    connectedClients++;
    console.log(`[ws] Client connected (id=${clientId}, total=${connectedClients})`);

    ws.send(JSON.stringify({ type: 'connected', message: 'SMS Platform WebSocket connected', clientCount: connectedClients }));

    // ── Pong handler: marks this connection as alive ───────────────────
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', (code, reason) => {
      connectedClients = Math.max(0, connectedClients - 1);
      console.log(`[ws] Client disconnected (id=${ws.clientId}, code=${code}, total=${connectedClients})`);
    });

    ws.on('error', (err) => {
      console.error(`[ws] Error (id=${ws.clientId}):`, err.message);
    });
  });

  // ── Heartbeat: ping all clients, terminate unresponsive ones ───────
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log(`[ws] Terminating unresponsive client (id=${ws.clientId})`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  return wss;
}

export function broadcast(event) {
  if (!wss) return;
  const payload = JSON.stringify(event);
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(payload);
        sent++;
      } catch (e) {
        console.error(`[ws] Send error to ${client.clientId}:`, e.message);
      }
    }
  });
}

export { wss };

/** Returns the number of currently connected WebSocket clients. */
export function getConnectedCount() {
  return connectedClients;
}

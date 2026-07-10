import { useEffect, useRef, useSyncExternalStore } from 'react';

let socket = null;
const handlers = new Set();

// ── Connection state (reactive via useSyncExternalStore) ───────────────
const CONN_STATUS = {
  CONNECTING: 'connecting',
  OPEN:       'open',
  CLOSED:     'closed',
};

let currentStatus = CONN_STATUS.CLOSED;
const statusListeners = new Set();

function notifyStatusListeners() {
  statusListeners.forEach((fn) => { try { fn(); } catch (_) {} });
}

function setStatus(s) {
  if (currentStatus !== s) {
    currentStatus = s;
    notifyStatusListeners();
  }
}

/** Subscribe to connection status changes. Returns an unsubscribe function. */
export function subscribeToStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Snapshot of current connection status (for useSyncExternalStore). */
export function getConnectionStatus() {
  return currentStatus;
}

/** React hook that returns the current connection status ('connecting' | 'open' | 'closed'). */
export function useConnectionStatus() {
  return useSyncExternalStore(subscribeToStatus, getConnectionStatus, getConnectionStatus);
}

// ── Reconnect state (exponential backoff with jitter) ──────────────────
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 50;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/** Compute next reconnect delay with jitter: 1s → 2s → 4s → 8s → 16s → 30s max */
function getReconnectDelay() {
  const exponential = Math.min(BASE_DELAY_MS * Math.pow(2, reconnectAttempt - 1), MAX_DELAY_MS);
  // Add ±25% jitter to avoid all clients reconnecting at once
  const jitter = exponential * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

// ── Keepalive ping interval (client-side) ─────────────────────────────
const KEEPALIVE_INTERVAL_MS = 25_000;
let keepaliveTimer = null;

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Send a lightweight ping — the server will respond with a pong frame
      // (WebSocket protocol-level, not application-level)
      try { socket.send('{"type":"ping"}'); } catch (_) {}
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

// ── URL resolution ─────────────────────────────────────────────────────

function getWsUrl() {
  if (import.meta.env.DEV) {
    const host = import.meta.env.VITE_SERVER_HOST || 'http://localhost';
    const port = import.meta.env.VITE_SERVER_PORT || '3001';
    const base = `${host.replace(/\/+$/, '')}:${port}`;
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

// ── Connection logic ───────────────────────────────────────────────────

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    console.warn(`[ws] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
    setStatus(CONN_STATUS.CLOSED);
    return;
  }

  reconnectAttempt++;
  setStatus(CONN_STATUS.CONNECTING);

  socket = new WebSocket(getWsUrl());

  socket.addEventListener('open', () => {
    console.log(`[ws] Connected (attempt ${reconnectAttempt})`);
    reconnectAttempt = 0; // reset on successful connection
    setStatus(CONN_STATUS.OPEN);
    startKeepalive();
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      // Swallow protocol-level pings silently
      if (data.type === 'ping') return;
      handlers.forEach((handler) => {
        try { handler(data); } catch (_) {}
      });
    } catch (_) {}
  });

  socket.addEventListener('close', () => {
    stopKeepalive();
    socket = null;
    setStatus(CONN_STATUS.CLOSED);

    const delay = getReconnectDelay();
    console.log(`[ws] Disconnected — reconnecting in ${delay}ms (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(connect, delay);
  });

  socket.addEventListener('error', () => {
    socket && socket.close();
  });
}

// Start the initial connection
connect();

/**
 * React hook that subscribes a handler to all incoming WebSocket messages.
 * The handler always receives the latest parsed JSON object.
 */
export function useWS(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn = (data) => handlerRef.current(data);
    handlers.add(fn);
    return () => handlers.delete(fn);
  }, []);
}

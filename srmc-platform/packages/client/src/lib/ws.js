import { useEffect, useRef } from 'react';

let socket = null;
const handlers = new Set();

function getWsUrl() {
  if (import.meta.env.DEV) {
    return 'ws://localhost:3001/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(getWsUrl());

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handlers.forEach((handler) => {
        try { handler(data); } catch (_) {}
      });
    } catch (_) {}
  });

  socket.addEventListener('close', () => {
    socket = null;
    setTimeout(connect, 3000);
  });

  socket.addEventListener('error', () => {
    socket && socket.close();
  });
}

connect();

export function useWS(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn = (data) => handlerRef.current(data);
    handlers.add(fn);
    return () => handlers.delete(fn);
  }, []);
}

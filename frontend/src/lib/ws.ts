import type { ServerEvent } from '@agemon/shared';
import { showToast } from './toast';

type Listener = (event: ServerEvent) => void;
type ConnectionListener = (connected: boolean) => void;

let socket: WebSocket | null = null;
let connected = false;
const listeners = new Set<Listener>();
const connectionListeners = new Set<ConnectionListener>();

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const fn of [...connectionListeners]) fn(value);
}

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem('agemon_key') ?? '';
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function connectWs() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    setConnected(true);
  };

  socket.onmessage = (e) => {
    try {
      const event: ServerEvent = JSON.parse(e.data);
      for (const fn of [...listeners]) fn(event);
    } catch {
      console.warn('[ws] failed to parse message');
    }
  };

  socket.onclose = () => {
    setConnected(false);
    socket = null;
    setTimeout(connectWs, 3_000);
  };

  socket.onerror = () => {
    setConnected(false);
    showToast({ title: 'Connection lost', description: 'Reconnecting…', variant: 'destructive' });
  };
}

export function onServerEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribe to WebSocket connection state changes. Returns an unsubscribe function. */
export function onConnectionChange(fn: ConnectionListener) {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

/** Returns current connection state. */
export function isWsConnected() {
  return connected;
}

import type { ServerEvent, ClientEvent } from '@agemon/shared';
import { showToast } from './toast';
import { STORAGE_KEY } from '@/lib/api';
import { useWsStore } from '@/lib/store';

type Listener = (event: ServerEvent) => void;
type ConnectionListener = (connected: boolean) => void;

let socket: WebSocket | null = null;
let connected = false;
let reconnectDelay = 1_000;
let shouldReconnect = false;
const listeners = new Set<Listener>();
const connectionListeners = new Set<ConnectionListener>();

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const fn of [...connectionListeners]) fn(value);
}

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem(STORAGE_KEY) ?? '';
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function connectWs() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  shouldReconnect = true;
  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    reconnectDelay = 1_000;
    setConnected(true);

    // Send resume if we have a lastSeq (reconnecting, not first connect).
    // Invariant: lastSeq === 0 on first connect, so resume is never sent on page load.
    const { lastSeq } = useWsStore.getState();
    if (lastSeq > 0) {
      socket!.send(JSON.stringify({ type: 'resume', lastSeq }));
      console.info(`[ws] sent resume, lastSeq=${lastSeq}`);
    }
  };

  socket.onmessage = (e) => {
    try {
      const event: ServerEvent = JSON.parse(e.data);
      for (const fn of [...listeners]) fn(event);
    } catch {
      console.warn('[ws] failed to parse message');
    }
  };

  socket.onerror = () => {
    setConnected(false);
  };

  socket.onclose = () => {
    if (connected) {
      showToast({ title: 'Connection lost', description: 'Reconnecting…', variant: 'destructive' });
    }
    setConnected(false);
    socket = null;
    if (!shouldReconnect) return;
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connectWs();
    }, reconnectDelay);
  };
}

export function disconnectWs() {
  shouldReconnect = false;
  socket?.close();
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

/** Send a client event to the server. */
export function sendClientEvent(event: ClientEvent) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  } else {
    console.warn('[ws] cannot send event — not connected');
  }
}

/** Returns current connection state. */
export function isWsConnected() {
  return connected;
}

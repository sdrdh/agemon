import type { ServerEvent } from '@agemon/shared';

type Listener = (event: ServerEvent) => void;
type ConnectionListener = (connected: boolean) => void;

const listeners = new Set<Listener>();
const connectionListeners = new Set<ConnectionListener>();

let source: EventSource | null = null;

function setConnected(value: boolean) {
  for (const fn of connectionListeners) fn(value);
}

function openSource(url: string) {
  if (source) source.close();

  source = new EventSource(url);

  source.onopen = () => {
    setConnected(true);
  };

  source.onerror = () => {
    // EventSource auto-reconnects — signal disconnected while retrying.
    setConnected(false);
  };

  source.onmessage = (e) => {
    if (!e.data) return; // keep-alive ping
    try {
      const event = JSON.parse(e.data) as ServerEvent;
      for (const fn of listeners) fn(event);
    } catch {
      console.warn('[sse] failed to parse message');
    }
  };
}

/** Connect to the SSE stream (no session filter). Call once on app startup. */
export function connectSSE() {
  openSource('/api/events');
}

/** Disconnect and stop reconnecting (call on app teardown). */
export function disconnectSSE() {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * Switch the SSE stream to watch a specific session (or undefined to revert to base stream).
 * Closes the current EventSource and opens a new one with ?activeSessionId=<id>.
 * Call when the user navigates to/from a session detail view.
 */
export function subscribeToSession(id: string | undefined) {
  const url = id
    ? `/api/events?activeSessionId=${encodeURIComponent(id)}`
    : '/api/events';
  openSource(url);
}

/** Subscribe to all server events. Returns an unsubscribe function. */
export function onServerEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribe to raw server events typed as unknown — for use by plugin pages. */
export function subscribeServerEvent(handler: (event: unknown) => void): () => void {
  const typedHandler: Listener = (event) => handler(event);
  listeners.add(typedHandler);
  return () => listeners.delete(typedHandler);
}

/** Subscribe to SSE connection state changes. Returns an unsubscribe function. */
export function onConnectionChange(fn: ConnectionListener) {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

/** Returns true if the SSE stream is currently open. */
export function isSSEConnected() {
  return source?.readyState === EventSource.OPEN;
}

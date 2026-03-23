// ─── Plugin Event Bridge ─────────────────────────────────────────────────────
// Allows plugins to register hooks (blocking, awaited in priority order) and
// listeners (fire-and-forget) for named events. The bridge also wraps the
// server's broadcast function so plugins can push WebSocket events to clients.
import type { ServerEventPayload } from '@agemon/shared';

interface HookEntry {
  pluginId: string;
  handler: (payload: unknown) => Promise<void>;
  priority: number;
}

interface ListenerEntry {
  pluginId: string;
  handler: (payload: unknown) => void;
}

export class EventBridge {
  private readonly hooks = new Map<string, HookEntry[]>();
  private readonly listeners = new Map<string, ListenerEntry[]>();
  private readonly broadcastFn: (wsEvent: ServerEventPayload) => void;

  constructor(broadcastFn: (wsEvent: ServerEventPayload) => void) {
    this.broadcastFn = broadcastFn;
  }

  /**
   * Register a blocking hook. The core will await all hooks for an event
   * in ascending priority order (lower number = runs first). Default priority 10.
   * If a hook throws, emit() propagates the error.
   */
  registerHook(
    pluginId: string,
    event: string,
    handler: (payload: unknown) => Promise<void>,
    opts?: { priority?: number },
  ): void {
    const priority = opts?.priority ?? 10;
    const entries = this.hooks.get(event) ?? [];
    entries.push({ pluginId, handler, priority });
    // Keep sorted by priority ascending so emit() can just iterate in order
    entries.sort((a, b) => a.priority - b.priority);
    this.hooks.set(event, entries);
  }

  /**
   * Register a fire-and-forget listener. Called after all hooks complete.
   * Errors are logged but do not propagate.
   */
  registerListener(
    pluginId: string,
    event: string,
    handler: (payload: unknown) => void,
  ): void {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ pluginId, handler });
    this.listeners.set(event, entries);
  }

  /**
   * Emit an event. Awaits all hooks in priority order (errors propagate),
   * then fires all listeners fire-and-forget (errors are logged).
   */
  async emit(event: string, payload: unknown): Promise<void> {
    // Run hooks sequentially in priority order — errors propagate to caller
    const hookEntries = this.hooks.get(event) ?? [];
    for (const entry of hookEntries) {
      await entry.handler(payload);
    }

    // Fire listeners fire-and-forget — errors are caught and logged
    const listenerEntries = this.listeners.get(event) ?? [];
    for (const entry of listenerEntries) {
      try {
        entry.handler(payload);
      } catch (err) {
        console.error(`[plugin:${entry.pluginId}] listener error on event "${event}":`, (err as Error).message);
      }
    }
  }

  /**
   * Send a WebSocket event to all connected clients via the injected broadcast fn.
   */
  broadcast(wsEvent: object): void {
    this.broadcastFn(wsEvent as ServerEventPayload);
  }

  /**
   * Remove all hooks and listeners registered by a plugin.
   * Call this before hot-reloading a plugin so stale handlers don't accumulate.
   */
  removePlugin(pluginId: string): void {
    for (const [event, entries] of this.hooks) {
      const filtered = entries.filter(e => e.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(event);
      } else {
        this.hooks.set(event, filtered);
      }
    }

    for (const [event, entries] of this.listeners) {
      const filtered = entries.filter(e => e.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.listeners.delete(event);
      } else {
        this.listeners.set(event, filtered);
      }
    }
  }
}

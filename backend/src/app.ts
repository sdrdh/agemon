import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { EventEmitter } from 'events';
import type { ServerEventPayload } from '@agemon/shared';

const HTTP_STATUS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export interface AppContext {
  app: Hono;
  broadcast: (event: ServerEventPayload) => void;
  eventBus: EventEmitter;
}

type SSEClient = {
  stream: SSEStreamingApi;
  activeSessionId: string | undefined;
};

// Heavy events are only sent to clients watching the specific session.
// All other events go to every connected client.
const HEAVY_EVENTS = new Set(['agent_thought', 'terminal_output']);

export const eventBus = new EventEmitter();
const sseClients = new Set<SSEClient>();

export function broadcast(event: ServerEventPayload) {
  const payload = JSON.stringify(event);
  const sessionId = (event as Record<string, unknown>).sessionId as string | undefined;
  const isHeavy = HEAVY_EVENTS.has(event.type);

  for (const client of sseClients) {
    if (isHeavy && client.activeSessionId !== sessionId) continue;
    client.stream.writeSSE({ data: payload }).catch(() => {
      sseClients.delete(client);
    });
  }
}

export function createApp(): AppContext {
  const app = new Hono();

  // ─── CORS (dev only) ────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/*', cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      allowHeaders: ['Content-Type', 'Last-Event-ID'],
    }));
  }

  // ─── Request Logger ─────────────────────────────────────────────────────────
  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    if (c.req.path !== '/api/events') {
      console.info(`[http] ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
    }
  });

  // ─── Error Handler ──────────────────────────────────────────────────────────
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const status = err.status;
      const error = HTTP_STATUS[status] ?? 'Error';
      return c.json({ error, message: err.message, statusCode: status }, status);
    }
    if (err.message?.includes('CHECK constraint failed')) {
      return c.json({ error: 'Bad Request', message: 'Invalid field value', statusCode: 400 }, 400);
    }
    console.error('[error]', err);
    return c.json({ error: 'Internal Server Error', message: 'Internal Server Error', statusCode: 500 }, 500);
  });

  // ─── Health ─────────────────────────────────────────────────────────────────
  app.get('/api/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  // ─── SSE Event Stream ────────────────────────────────────────────────────────
  // Clients connect here for real-time server push.
  // ?activeSessionId=xyz → heavy events (agent_thought, terminal_output) are
  // only delivered if the event's sessionId matches. State events always delivered.
  app.get('/api/events', (c) => {
    const user =
      c.req.header('tailscale-user-login') ??
      c.req.header('remote-user') ??
      'anonymous';
    const activeSessionId = c.req.query('activeSessionId') ?? undefined;

    return streamSSE(c, async (stream) => {
      const client: SSEClient = { stream, activeSessionId };
      sseClients.add(client);
      console.info(`[sse] client connected user=${user} activeSession=${activeSessionId ?? 'none'} (total: ${sseClients.size})`);

      // Keep-alive ping every 15 seconds to prevent proxy timeouts
      const pingInterval = setInterval(() => {
        stream.writeSSE({ data: '' }).catch(() => {});
      }, 15_000);

      // Block until client disconnects
      let resolve!: () => void;
      const done = new Promise<void>((res) => { resolve = res; });
      stream.onAbort(() => {
        sseClients.delete(client);
        clearInterval(pingInterval);
        console.info(`[sse] client disconnected (total: ${sseClients.size})`);
        resolve();
      });

      try {
        await done;
      } finally {
        clearInterval(pingInterval);
        sseClients.delete(client);
      }
    });
  });

return { app, broadcast, eventBus };
}

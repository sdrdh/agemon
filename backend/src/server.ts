import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { HTTPException } from 'hono/http-exception';
import type { WSContext } from 'hono/ws';
import { EventEmitter } from 'events';
import { timingSafeEqual } from 'node:crypto';
import { runMigrations, db } from './db/client.ts';
import type { ServerEvent, ClientEvent } from '@agemon/shared';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const AGEMON_KEY = process.env.AGEMON_KEY ?? '';

if (!AGEMON_KEY) {
  console.error('[error] AGEMON_KEY is not set — exiting');
  process.exit(1);
}

const HTTP_STATUS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export const app = new Hono();

// ─── Internal Event Bus ───────────────────────────────────────────────────────
export const eventBus = new EventEmitter();

// ─── CORS (scoped to /api/* only — avoids conflict with upgradeWebSocket) ─────
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/*', cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
    allowHeaders: ['Authorization', 'Content-Type'],
  }));
}

// ─── Request Logger ───────────────────────────────────────────────────────────
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.info(`[http] ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
app.use(async (c, next) => {
  const path = c.req.path;
  if (path === '/api/health' || path === '/ws') return next();

  const auth = c.req.header('authorization') ?? '';
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${AGEMON_KEY}`);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or missing AGEMON_KEY', statusCode: 401 }, 401);
  }
  return next();
});

// ─── Error Handler ────────────────────────────────────────────────────────────
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

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ─── WebSocket ────────────────────────────────────────────────────────────────
const WS_OPEN = 1 as const; // WebSocket OPEN readyState
const WS_CLIENT_EVENT_TYPES = new Set(['send_input', 'terminal_input', 'send_message']);
const wsClients = new Set<WSContext>();

app.use('/ws', async (c, next) => {
  const token = c.req.query('token') ?? '';
  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(AGEMON_KEY);
  if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token', statusCode: 401 }, 401);
  }
  return next();
});

app.get('/ws', upgradeWebSocket((_c) => ({
  onOpen(_event, ws) {
    wsClients.add(ws);
    console.info(`[ws] client connected (total: ${wsClients.size})`);
  },
  onMessage(event, _ws) {
    try {
      const ev: ClientEvent = JSON.parse(String(event.data));
      if (!ev || typeof ev.type !== 'string' || !WS_CLIENT_EVENT_TYPES.has(ev.type)) {
        console.warn('[ws] unknown client event type:', ev?.type);
        return;
      }
      if (ev.type === 'terminal_input') {
        console.info(`[ws] terminal_input session=${ev.sessionId}`);
      } else {
        console.info('[ws] client event', ev.type);
      }
      eventBus.emit('ws:client_event', ev);
    } catch {
      console.warn('[ws] failed to parse client message');
    }
  },
  onClose(_event, ws) {
    wsClients.delete(ws);
    console.info(`[ws] client disconnected (total: ${wsClients.size})`);
  },
})));

export function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const client of [...wsClients]) {
    if (client.readyState === WS_OPEN) client.send(payload);
  }
}

// ─── Client Event Handlers ───────────────────────────────────────────────────
eventBus.on('ws:client_event', async (ev: ClientEvent) => {
  if (ev.type === 'send_input') {
    const input = db.answerInput(ev.inputId, ev.response);
    if (!input) {
      console.warn(`[ws] send_input: unknown inputId ${ev.inputId}`);
      return;
    }

    // Relay the response to the running agent process
    const { sendInputToAgent } = await import('./lib/acp.ts');
    if (input.session_id) {
      const sent = sendInputToAgent(input.session_id, ev.inputId, ev.response);
      if (!sent) {
        console.warn(`[ws] send_input: could not relay to agent session ${input.session_id}`);
      }
    }

    const pending = db.listPendingInputs(ev.taskId);
    if (pending.length === 0) {
      db.updateTask(ev.taskId, { status: 'working' });
      const task = db.getTask(ev.taskId);
      if (task) broadcast({ type: 'task_updated', task });
    }
    console.info(`[ws] send_input answered for task=${ev.taskId} input=${ev.inputId}`);
  }

  if (ev.type === 'send_message') {
    const { getRunningSession, sendPromptTurn } = await import('./lib/acp.ts');
    const session = getRunningSession(ev.taskId);
    if (!session) {
      console.warn(`[ws] send_message: no running session for task=${ev.taskId}`);
      return;
    }
    try {
      await sendPromptTurn(session.id, ev.content);
    } catch (err) {
      console.error(`[ws] send_message error for task=${ev.taskId}:`, (err as Error).message);
    }
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
try {
  runMigrations();
} catch (err) {
  console.error('[db] migration failed — exiting', err);
  process.exit(1);
}

const { tasksRoutes } = await import('./routes/tasks.ts');
app.route('/api', tasksRoutes);

// ─── Start ────────────────────────────────────────────────────────────────────
Bun.serve({ fetch: app.fetch, websocket, port: PORT, hostname: HOST });
console.log(`[agemon] backend listening on http://${HOST}:${PORT}`);

// ─── Crash Recovery + Graceful Shutdown ──────────────────────────────────────
// Dynamic import avoids circular dependency: acp.ts imports broadcast from server.ts
const { recoverInterruptedSessions, shutdownAllSessions } = await import('./lib/acp.ts');
recoverInterruptedSessions();

process.on('SIGINT', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

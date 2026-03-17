import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { HTTPException } from 'hono/http-exception';
import type { WSContext } from 'hono/ws';
import { EventEmitter } from 'events';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { db } from './db/client.ts';
import type { ServerEvent, ServerEventPayload, ClientEvent } from '@agemon/shared';

const HTTP_STATUS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export interface AppOptions {
  key: string;
}

export interface AppContext {
  app: Hono;
  broadcast: (event: ServerEventPayload) => void;
  eventBus: EventEmitter;
  wsClients: Set<WSContext>;
}

/** Derive a cookie token from the key — never store the raw key in a cookie. */
function deriveCookieToken(key: string): string {
  return createHmac('sha256', key).update('agemon_session').digest('hex');
}

export function createApp(opts: AppOptions): AppContext {
  const app = new Hono();
  const cookieToken = deriveCookieToken(opts.key);
  const eventBus = new EventEmitter();

  // ─── CORS (scoped to /api/* only — avoids conflict with upgradeWebSocket) ─────
  // Only needed in dev (Vite on :5173 → backend on :3000 = cross-origin).
  // In production, frontend is served by the same server — same-origin, no CORS needed.
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
    // Skip auth for non-API routes (frontend static files), health, version, and WebSocket
    // /ws has its own token-based auth via query param
    // /api/auth is the login endpoint — must be accessible without auth
    if (path === '/ws' || path === '/api/health' || path === '/api/version' || path === '/api/auth' || path === '/api/auth/logout') return next();
    // Only protect /api/*, /mcp*, and /p/* routes
    if (!path.startsWith('/api') && !path.startsWith('/mcp') && !path.startsWith('/p/')) return next();

    // Check Bearer header first, then fall back to cookie
    const auth = c.req.header('authorization') ?? '';
    const cookie = getCookie(c, 'agemon_session') ?? '';

    let authenticated = false;

    // Try Bearer token
    if (auth) {
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(`Bearer ${opts.key}`);
      if (authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf)) {
        authenticated = true;
      }
    }

    // Try cookie (HMAC-derived token, not the raw key)
    if (!authenticated && cookie) {
      const cookieBuf = Buffer.from(cookie);
      const tokenBuf = Buffer.from(cookieToken);
      if (cookieBuf.length === tokenBuf.length && timingSafeEqual(cookieBuf, tokenBuf)) {
        authenticated = true;
      }
    }

    if (!authenticated) {
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

  // ─── Auth (cookie login) ───────────────────────────────────────────────────
  app.post('/api/auth', (c) => {
    const auth = c.req.header('authorization') ?? '';
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(`Bearer ${opts.key}`);
    if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
      return c.json({ error: 'Unauthorized', message: 'Invalid AGEMON_KEY', statusCode: 401 }, 401);
    }
    setCookie(c, 'agemon_session', cookieToken, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 31536000, // 1 year
    });
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, 'agemon_session', { path: '/' });
    return c.json({ ok: true });
  });

  // ─── Event Sequencing ───────────────────────────────────────────────────────
  const epoch = Date.now().toString();
  let globalSeq = 0;
  const EVENT_RING_SIZE = 500;
  const eventRing: ServerEvent[] = [];
  let ringHead = 0;

  // ─── WebSocket ────────────────────────────────────────────────────────────────
  const WS_OPEN = 1 as const; // WebSocket OPEN readyState
  const WS_CLIENT_EVENT_TYPES = new Set([
    'send_input', 'terminal_input', 'send_message', 'approval_response',
    'set_config_option', 'cancel_turn', 'resume',
  ]);
  const wsClients = new Set<WSContext>();

  app.use('/ws', async (c, next) => {
    // Try cookie first (no token in URL), fall back to query param for backward compat
    const cookie = getCookie(c, 'agemon_session') ?? '';
    if (cookie) {
      const cookieBuf = Buffer.from(cookie);
      const tokenBuf = Buffer.from(cookieToken);
      if (cookieBuf.length === tokenBuf.length && timingSafeEqual(cookieBuf, tokenBuf)) {
        return next();
      }
    }
    const token = c.req.query('token') ?? '';
    if (token) {
      const tokenBuf = Buffer.from(token);
      const keyBuf = Buffer.from(opts.key);
      if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
        return next();
      }
    }
    return c.json({ error: 'Unauthorized', message: 'Invalid token', statusCode: 401 }, 401);
  });

  app.get('/ws', upgradeWebSocket((_c) => ({
    onOpen(_event, ws) {
      wsClients.add(ws);
      console.info(`[ws] client connected (total: ${wsClients.size})`);
    },
    onMessage(event, ws) {
      try {
        const ev = JSON.parse(String(event.data));
        if (!ev || typeof ev.type !== 'string') {
          console.warn('[ws] unknown client event');
          return;
        }

        // Handle resume directly — connection-level, not a business event
        if (ev.type === 'resume' && typeof ev.lastSeq === 'number') {
          const lastSeq = ev.lastSeq as number;
          console.info(`[ws] resume requested, lastSeq=${lastSeq}, globalSeq=${globalSeq}`);

          // Check if lastSeq falls outside ring buffer.
          // ringHead===0 → empty → nothing to replay, skip.
          // ringHead < SIZE → not wrapped → oldest is at index 0.
          // ringHead >= SIZE → wrapped → oldest is at ringHead%SIZE.
          if (ringHead === 0) {
            // Ring is empty — nothing to replay
            console.info('[ws] ring empty, nothing to replay');
            return;
          }
          const oldest = ringHead >= EVENT_RING_SIZE
            ? eventRing[ringHead % EVENT_RING_SIZE]?.seq ?? Infinity
            : eventRing[0]?.seq ?? Infinity;
          if (lastSeq < oldest) {
            // Gap unrecoverable — tell client to refetch
            const syncEvent = { type: 'full_sync_required' as const, seq: globalSeq, epoch };
            ws.send(JSON.stringify(syncEvent));
            console.info(`[ws] sent full_sync_required (lastSeq=${lastSeq} < oldest=${oldest})`);
            return;
          }

          // Replay events with seq > lastSeq. Ring stores events in seq order
          // (append-only), so positional iteration preserves chronological ordering.
          const bufferLen = Math.min(ringHead, EVENT_RING_SIZE);
          let replayed = 0;
          const startIdx = ringHead >= EVENT_RING_SIZE ? ringHead % EVENT_RING_SIZE : 0;
          for (let i = 0; i < bufferLen; i++) {
            const idx = (startIdx + i) % EVENT_RING_SIZE;
            const e = eventRing[idx];
            if (e && e.seq > lastSeq) {
              ws.send(JSON.stringify(e));
              replayed++;
            }
          }
          console.info(`[ws] replayed ${replayed} events`);
          return;
        }

        if (!WS_CLIENT_EVENT_TYPES.has(ev.type)) {
          console.warn('[ws] unknown client event type:', ev.type);
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

  function broadcast(event: ServerEventPayload) {
    const seq = ++globalSeq;
    const e = { ...event, seq, epoch } as ServerEvent;
    eventRing[ringHead % EVENT_RING_SIZE] = e;
    ringHead++;
    const payload = JSON.stringify(e);
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
      const { sendInputToAgent } = await import('./lib/acp/index.ts');
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

    else if (ev.type === 'send_message') {
      const { sendPromptTurn } = await import('./lib/acp/index.ts');
      try {
        await sendPromptTurn(ev.sessionId, ev.content);
      } catch (err) {
        console.error(`[ws] send_message error for session=${ev.sessionId}:`, (err as Error).message);
      }
    }

    else if (ev.type === 'approval_response') {
      const { resolveApproval } = await import('./lib/acp/index.ts');
      const resolved = resolveApproval(ev.approvalId, ev.decision);
      if (!resolved) {
        console.warn(`[ws] approval_response: could not resolve approvalId ${ev.approvalId}`);
      }
      console.info(`[ws] approval resolved: ${ev.approvalId} → ${ev.decision}`);
    }

    else if (ev.type === 'set_config_option') {
      const { setSessionConfigOption } = await import('./lib/acp/index.ts');
      try {
        await setSessionConfigOption(ev.sessionId, ev.configId, ev.value);
        console.info(`[ws] set_config_option: ${ev.configId}=${ev.value} on session=${ev.sessionId}`);
      } catch (err) {
        console.error(`[ws] set_config_option error for session=${ev.sessionId}:`, (err as Error).message);
      }
    }

    else if (ev.type === 'cancel_turn') {
      const { cancelTurn } = await import('./lib/acp/index.ts');
      try {
        cancelTurn(ev.sessionId);
        console.info(`[ws] cancel_turn: session=${ev.sessionId}`);
      } catch (err) {
        console.error(`[ws] cancel_turn error for session=${ev.sessionId}:`, (err as Error).message);
      }
    }
  });

  // ─── Routes ───────────────────────────────────────────────────────────────────
  // Routes are mounted asynchronously in the startup function after migrations
  // This function returns the app before routes are mounted so they can be added dynamically

  return { app, broadcast, eventBus, wsClients };
}

// Export websocket for Bun.serve (re-export from hono/bun)
export { websocket } from 'hono/bun';

# SSE Refactor: WebSocket → Hybrid SSE + REST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bidirectional WebSocket architecture with a Hybrid SSE (server push) + REST (client actions) pattern, filtering heavy events by active session for mobile battery efficiency.

**Architecture:** The server exposes `GET /api/events` as a filtered SSE stream — lightweight state events go to all clients, heavy streaming events (`agent_thought`, `terminal_output`) only go to the client whose `activeSessionId` matches. Client actions (send message, respond to input, approve, cancel, set config) become standard `POST` REST endpoints. The frontend swaps its `WebSocket` for a native `EventSource` that reconnects automatically and re-subscriptions (route change to/from a session view) close the old `EventSource` and open a new one with the correct `activeSessionId` query param.

**Tech Stack:** Hono `streamSSE` (hono/streaming), native browser `EventSource`, existing Zustand + TanStack Query pattern unchanged.

---

## File Map

### Backend — modified
| File | Change |
|------|--------|
| `backend/src/app.ts` | Remove WS upgrade/clients/eventBus handler; add SSE endpoint + filtered broadcast; remove seq/epoch/ring buffer; update `AppContext` |
| `backend/src/server.ts` | Remove `websocket` import + `Bun.serve` websocket field |
| `backend/src/routes/sessions.ts` | Add `POST /:id/messages`, `POST /:id/inputs/:inputId/respond`, `POST /:id/cancel`, `POST /:id/config`, `POST /:id/terminal` |
| `backend/src/routes/approvals.ts` | Add `POST /:id/resolve` |

### Frontend — modified
| File | Change |
|------|--------|
| `frontend/src/lib/events.ts` *(rename from `ws.ts`)* | Replace `WebSocket` with `EventSource`; expose `subscribeToSession(id?)`; drop `sendClientEvent`, seq/epoch state |
| `frontend/src/components/custom/events-provider.tsx` *(rename from `ws-provider.tsx`)* | Remove seq/epoch/full_sync_required handling; keep event→store dispatch logic |
| `frontend/src/App.tsx` | Update imports: `ws` → `events`, `WsProvider` → `EventsProvider`; remove `ConnectionBanner` |
| `frontend/src/main.tsx` | `connectWs` → `connectSSE`; `subscribeWsEvent` → `subscribeServerEvent` |
| `frontend/src/routes/index.tsx` | Replace `sendClientEvent` calls with `fetch` POSTs |
| `frontend/src/hooks/use-session-chat.ts` | Replace `sendClientEvent` calls with `fetch` POSTs |
| `frontend/src/components/custom/session-chat-panel.tsx` | Replace `sendClientEvent` call with `fetch` POST |

### Shared types — modified
| File | Change |
|------|--------|
| `shared/types/index.ts` | Remove `ClientEvent`; remove `seq`/`epoch` from `ServerEventBase`; remove `full_sync_required` event variant |

### Deleted
- `frontend/src/lib/ws.ts`
- `frontend/src/components/custom/ws-provider.tsx`
- `frontend/src/components/custom/connection-banner.tsx`

---

## New REST Endpoints

| Method | Path | Body | Replaces ClientEvent |
|--------|------|------|---------------------|
| POST | `/api/sessions/:id/messages` | `{ content: string }` | `send_message` |
| POST | `/api/sessions/:id/inputs/:inputId/respond` | `{ response: string }` | `send_input` |
| POST | `/api/sessions/:id/cancel` | `{}` | `cancel_turn` |
| POST | `/api/sessions/:id/config` | `{ configId: string; value: string }` | `set_config_option` |
| POST | `/api/sessions/:id/terminal` | `{ data: string }` | `terminal_input` |
| POST | `/api/approvals/:id/resolve` | `{ decision: 'allow_once' \| 'allow_always' \| 'deny' }` | `approval_response` |

---

## Task 1: Backend — REST Action Routes

**Files:**
- Modify: `backend/src/routes/sessions.ts`
- Modify: `backend/src/routes/approvals.ts`

Add all action endpoints. The handler logic is moved verbatim from `app.ts`'s `eventBus.on('ws:client_event', ...)` handler.

- [ ] **Step 1: Add session action routes to `sessions.ts`**

Append after the last existing route in `backend/src/routes/sessions.ts`. The imports already include `sendPromptTurn`, `setSessionConfigOption` — add the missing ones (`cancelTurn`, `sendInputToAgent`) and `db`:

```typescript
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import {
  stopAgent, getActiveSession, resumeSession,
  setSessionConfigOption, getSessionConfigOptions, getSessionAvailableCommands,
  sendPromptTurn, cancelTurn, sendInputToAgent,
} from '../lib/acp/index.ts';
```

Then add these routes at the end of the file:

```typescript
/**
 * POST /sessions/:id/messages — send a prompt message to a running session.
 * Body: { content: string }
 */
sessionsRoutes.post('/sessions/:id/messages', async (c) => {
  const sessionId = c.req.param('id');
  let body: { content?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (!body.content || typeof body.content !== 'string') return sendError(400, 'content is required');
  try {
    await sendPromptTurn(sessionId, body.content);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/inputs/:inputId/respond — answer a pending input prompt.
 * Body: { response: string }
 */
sessionsRoutes.post('/sessions/:id/inputs/:inputId/respond', async (c) => {
  const sessionId = c.req.param('id');
  const inputId = c.req.param('inputId');
  let body: { response?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (typeof body.response !== 'string') return sendError(400, 'response is required');

  const input = db.answerInput(inputId, body.response);
  if (!input) return sendError(404, `Unknown inputId: ${inputId}`);

  const sent = sendInputToAgent(sessionId, inputId, body.response);
  if (!sent) console.warn(`[api] send_input: could not relay to agent session ${sessionId}`);

  if (input.task_id) {
    const pending = db.listPendingInputs(input.task_id);
    if (pending.length === 0) {
      db.updateTask(input.task_id, { status: 'working' });
      const task = db.getTask(input.task_id);
      if (task) broadcast({ type: 'task_updated', task });
    }
  }
  return c.json({ ok: true });
});

/**
 * POST /sessions/:id/cancel — cancel the running turn.
 */
sessionsRoutes.post('/sessions/:id/cancel', async (c) => {
  const sessionId = c.req.param('id');
  try {
    cancelTurn(sessionId);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/config — update a session config option (e.g. model, mode).
 * Body: { configId: string; value: string }
 */
sessionsRoutes.post('/sessions/:id/config', async (c) => {
  const sessionId = c.req.param('id');
  let body: { configId?: string; value?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (!body.configId || typeof body.value !== 'string') return sendError(400, 'configId and value are required');
  try {
    await setSessionConfigOption(sessionId, body.configId, body.value);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/terminal — send raw bytes to a terminal session.
 * Body: { data: string }
 */
sessionsRoutes.post('/sessions/:id/terminal', async (c) => {
  const sessionId = c.req.param('id');
  let body: { data?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (typeof body.data !== 'string') return sendError(400, 'data is required');
  // Emit to event bus so any terminal PTY handler can pick it up
  const { eventBus } = await import('../app.ts');
  eventBus.emit('ws:client_event', { type: 'terminal_input', sessionId, data: body.data });
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Add approval resolve route to `approvals.ts`**

Read current `backend/src/routes/approvals.ts`, then append:

```typescript
import { resolveApproval } from '../lib/acp/index.ts';
```

(add to existing imports at top) and append this route:

```typescript
/**
 * POST /approvals/:id/resolve — resolve a pending tool approval.
 * Body: { decision: 'allow_once' | 'allow_always' | 'deny' }
 */
approvalsRoutes.post('/approvals/:id/resolve', async (c) => {
  const approvalId = c.req.param('id');
  let body: { decision?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  const decision = body.decision;
  if (decision !== 'allow_once' && decision !== 'allow_always' && decision !== 'deny') {
    return sendError(400, 'decision must be allow_once, allow_always, or deny');
  }
  const resolved = resolveApproval(approvalId, decision as ApprovalDecision);
  if (!resolved) return sendError(404, `Unknown or already resolved approvalId: ${approvalId}`);
  return c.json({ ok: true });
});
```

> Note: `ApprovalDecision` is already imported via `@agemon/shared` if it's there; add `import type { ApprovalDecision } from '@agemon/shared';` if missing.

- [ ] **Step 3: Verify the app still compiles**

```bash
cd backend && bun run --bun tsc --noEmit 2>&1 | head -40
```

Expected: zero type errors (or only pre-existing errors unrelated to these routes).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/sessions.ts backend/src/routes/approvals.ts
git commit -m "feat: add REST action endpoints for session messages, inputs, approvals, cancel, config, terminal"
```

---

## Task 2: Backend — SSE Endpoint + Broadcast Refactor (`app.ts`)

**Files:**
- Modify: `backend/src/app.ts`

Replace the entire WebSocket block with SSE. Remove seq/epoch/ring buffer. Update `broadcast` to write to SSE clients with filtering.

- [ ] **Step 1: Replace `app.ts` with the SSE implementation**

Write the full new version of `backend/src/app.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { EventEmitter } from 'events';
import { db } from './db/client.ts';
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
    // Skip logging the SSE stream (it never "ends" until client disconnects)
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
  // Clients subscribe here for real-time server push.
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
      let resolve: () => void;
      const done = new Promise<void>((res) => { resolve = res; });
      stream.onAbort(() => {
        sseClients.delete(client);
        clearInterval(pingInterval);
        console.info(`[sse] client disconnected (total: ${sseClients.size})`);
        resolve();
      });

      await done;
    });
  });

  return { app, broadcast, eventBus };
}
```

- [ ] **Step 2: Update `server.ts` — remove websocket**

In `backend/src/server.ts`:

Change line 9:
```typescript
// Before:
import { createApp, websocket } from './app.ts';

// After:
import { createApp } from './app.ts';
```

Change line 177:
```typescript
// Before:
const { app, broadcast } = createApp();

// After:
const { app } = createApp();
```

Change `export { broadcast }` (line 180) to:
```typescript
export { broadcast } from './app.ts';
```

Change `Bun.serve` (line 291):
```typescript
// Before:
Bun.serve({ fetch: app.fetch, websocket, port: PORT, hostname: HOST });

// After:
Bun.serve({ fetch: app.fetch, port: PORT, hostname: HOST });
```

Also remove the `export { websocket } from 'hono/bun';` line at the bottom of `app.ts` (the old re-export that was there).

- [ ] **Step 3: Fix the `eventBus` import in `sessions.ts`**

The `terminal` route in Task 1 Step 1 imported `eventBus` from `app.ts`. Verify the import path is correct after the app.ts rewrite. The new `app.ts` exports `eventBus` as a module-level export (not just on AppContext), so:

```typescript
import { eventBus } from '../app.ts';
```

This is already what Task 1 Step 1 wrote.

- [ ] **Step 4: Check compile**

```bash
cd backend && bun run --bun tsc --noEmit 2>&1 | head -40
```

Expected: no new errors. Resolve any that reference the removed `wsClients` or `ClientEvent` type.

- [ ] **Step 5: Smoke test the SSE endpoint manually**

Start the backend:
```bash
cd backend && bun run src/server.ts 2>&1 &
sleep 2
curl -N http://127.0.0.1:3000/api/events
```

Expected: response headers include `Content-Type: text/event-stream`, connection stays open, empty ping data every 15s.

Kill the backend after testing: `pkill -f 'bun run src/server.ts'`

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.ts backend/src/server.ts
git commit -m "feat: replace WebSocket with filtered SSE stream, move client-event logic to REST"
```

---

## Task 3: Shared Types — Remove ClientEvent, seq/epoch

**Files:**
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Remove `ServerEventBase`, inline `seq`/`epoch` removal, remove `ClientEvent`, remove `full_sync_required`**

In `shared/types/index.ts`, find the WebSocket Event Types section (around line 228) and replace it with:

```typescript
// ─── Server-Sent Event Types ──────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'task_updated'; task: Task }
  | { type: 'agent_thought'; taskId: string | null; sessionId: string; content: string; eventType: 'thought' | 'action'; messageId?: string }
  | { type: 'awaiting_input'; taskId: string | null; sessionId: string; question: string; inputId: string }
  | { type: 'terminal_output'; sessionId: string; data: string }
  | { type: 'session_started'; taskId: string | null; session: AgentSession }
  | { type: 'session_ready'; taskId: string | null; session: AgentSession }
  | { type: 'session_state_changed'; sessionId: string; taskId: string | null; state: AgentSessionState }
  | { type: 'approval_requested'; approval: PendingApproval }
  | { type: 'approval_resolved'; approvalId: string; decision: ApprovalDecision }
  | { type: 'config_options_updated'; sessionId: string; taskId: string | null; configOptions: SessionConfigOption[] }
  | { type: 'available_commands'; sessionId: string; taskId: string | null; commands: AgentCommand[] }
  | { type: 'turn_cancelled'; sessionId: string; taskId: string | null }
  | { type: 'turn_completed'; sessionId: string; taskId: string | null }
  | { type: 'session_usage_update'; sessionId: string; taskId: string | null; usage: SessionUsage }
  | { type: 'update_available'; version: string; should_notify: boolean }
  | { type: 'extensions_changed'; extensionIds: string[] }
  | { type: 'server_restarting' };

/** Alias — broadcast() still uses this name in app.ts. No difference since seq/epoch removed. */
export type ServerEventPayload = ServerEvent;
```

Also delete the `ClientEvent` type (around line 260-267):
```typescript
// DELETE these lines:
export type ClientEvent =
  | { type: 'send_input'; sessionId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string }
  | { type: 'send_message'; sessionId: string; content: string }
  | { type: 'approval_response'; approvalId: string; decision: ApprovalDecision }
  | { type: 'set_config_option'; sessionId: string; configId: string; value: string }
  | { type: 'cancel_turn'; sessionId: string }
  | { type: 'resume'; lastSeq: number };
```

Also delete the `DistributiveOmit` type (it was only needed for `ServerEventPayload` before):
```typescript
// DELETE this line:
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
```

- [ ] **Step 2: Fix app.ts import**

In `backend/src/app.ts` line 8 now says:
```typescript
import type { ServerEventPayload } from '@agemon/shared';
```
Since `ServerEventPayload` is now identical to `ServerEvent`, this still works.

- [ ] **Step 3: Check compile (both backend and frontend)**

```bash
cd backend && bun run --bun tsc --noEmit 2>&1 | head -30
cd ../frontend && bun run --bun tsc --noEmit 2>&1 | head -30
```

Expected: errors only about `seq`, `epoch`, `ClientEvent`, `full_sync_required` — which are all the things we're removing in subsequent tasks. Note them; they'll be resolved in Tasks 4 and 5.

- [ ] **Step 4: Commit**

```bash
git add shared/types/index.ts
git commit -m "refactor: remove ClientEvent type, seq/epoch, and full_sync_required from shared types"
```

---

## Task 4: Frontend — Create `events.ts` (replaces `ws.ts`)

**Files:**
- Create: `frontend/src/lib/events.ts`

- [ ] **Step 1: Write `events.ts`**

Create `frontend/src/lib/events.ts`:

```typescript
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
    // EventSource auto-reconnects — just signal disconnected while retrying.
    // No manual backoff needed; browser handles it.
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

/** Connect to the SSE stream with no session filter (global state events only for heavy ones). */
export function connectSSE() {
  openSource('/api/events');
}

/** Disconnect and stop reconnecting (called on app teardown). */
export function disconnectSSE() {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * Switch the SSE stream to watch a specific session (or undefined to revert to base stream).
 * Closes the current EventSource and opens a new one — the browser reconnects automatically.
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
```

- [ ] **Step 2: Check types compile**

```bash
cd frontend && bun run --bun tsc --noEmit 2>&1 | grep events.ts
```

Expected: no errors in `events.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/events.ts
git commit -m "feat: add SSE events.ts replacing WebSocket ws.ts"
```

---

## Task 5: Frontend — Create `events-provider.tsx` (replaces `ws-provider.tsx`)

**Files:**
- Create: `frontend/src/components/custom/events-provider.tsx`

- [ ] **Step 1: Write `events-provider.tsx`**

The event dispatch logic (the big `switch` block) is preserved 1:1 — only the infrastructure imports and the seq/epoch/full_sync_required handling are removed:

```typescript
import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/events';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys, sessionKeys, dashboardKeys } from '@/lib/query';
import { applyToolCallEvent } from '@/lib/tool-call-helpers';
import { api } from '@/lib/api';
import { invalidateRendererCache } from '@/components/custom/chat-bubble';
import type { ServerEvent } from '@agemon/shared';

/** Shorten a file path to just the filename. */
function shortFile(path: string): string {
  return path.includes('/') ? path.split('/').pop()?.replace(/\s*\(.*$/, '') ?? '' : path;
}

/** Build an activity label from tool kind + args (structured JSON format). */
function structuredToolActivity(kind: string, args?: Record<string, string>): string {
  const file = args?.filePath || args?.file_path || args?.path || '';
  const short = file ? shortFile(file) : '';
  switch (kind) {
    case 'Read': return short ? `Reading ${short}` : 'Reading file...';
    case 'Edit': return short ? `Editing ${short}` : 'Editing file...';
    case 'Write': return short ? `Writing ${short}` : 'Writing file...';
    case 'Glob':
    case 'Grep':
    case 'Search': return 'Searching...';
    case 'Bash':
    case 'bash': return 'Running command...';
    case 'WebSearch':
    case 'web_search': return 'Searching the web...';
    case 'WebFetch':
    case 'web_fetch': return 'Fetching page...';
    case 'Agent': return 'Running agent...';
    case 'Skill': return 'Running skill...';
    default: return short ? `${kind} ${short}` : `Running ${kind}...`;
  }
}

/** Extract a short activity label from a legacy tool-call content string. */
function parseToolActivity(content: string): string {
  if (content.startsWith('[tool update]')) return '';
  const match = content.match(/^\[tool(?::[^\]]+)?\]\s+(\S+)\s+(.*?)(?:\s*\((?:pending|in_progress)\))?$/);
  if (!match) return 'Running tool...';
  return structuredToolActivity(match[1], { filePath: match[2]?.trim() ?? '' });
}

/**
 * Subscribes to SSE events once on mount and bridges them to
 * React Query cache + Zustand store.
 *
 * On SSE reconnect (EventSource auto-reconnects on error), React Query is
 * invalidated to refetch authoritative state from REST endpoints.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = useWsStore.getState;

    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          queryClient.setQueryData(taskKeys.detail(task.id), task);
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          queryClient.invalidateQueries({ queryKey: taskKeys.listsPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(task.id) });
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          break;
        }
        case 'agent_thought': {
          const msgId = event.messageId ?? crypto.randomUUID();
          store().appendChatMessage(event.sessionId, {
            id: msgId,
            role: 'agent',
            content: event.content,
            eventType: event.eventType ?? 'thought',
            timestamp: new Date().toISOString(),
          });
          store().markUnread(event.sessionId);

          let parsed: Record<string, unknown> | null = null;
          if (event.eventType === 'action') {
            try { parsed = JSON.parse(event.content); } catch { /* not JSON */ }
            if (parsed && typeof parsed.toolCallId === 'string') {
              applyToolCallEvent(parsed, event.sessionId, store().upsertToolCall);
            }
          }

          if (event.eventType === 'thought') {
            store().setAgentActivity(event.sessionId, 'Thinking...');
          } else if (event.eventType === 'action') {
            if (event.content.startsWith('[tool]') || event.content.startsWith('[tool:')) {
              const label = parseToolActivity(event.content);
              if (label) store().setAgentActivity(event.sessionId, label);
            } else if (event.content.startsWith('[tool update]')) {
              store().setAgentActivity(event.sessionId, null);
            } else if (parsed?.toolCallId && !parsed.isUpdate) {
              const label = structuredToolActivity(parsed.kind as string, parsed.args as Record<string, string> | undefined);
              if (label) store().setAgentActivity(event.sessionId, label);
            } else if (!parsed?.toolCallId) {
              store().setAgentActivity(event.sessionId, null);
            }
          }
          break;
        }
        case 'awaiting_input': {
          store().appendChatMessage(event.sessionId, {
            id: event.inputId,
            role: 'agent',
            content: event.question,
            eventType: 'input_request',
            timestamp: new Date().toISOString(),
          });
          store().addPendingInput({
            inputId: event.inputId,
            taskId: event.taskId,
            sessionId: event.sessionId,
            question: event.question,
            receivedAt: Date.now(),
          });
          store().markUnread(event.sessionId);
          store().setAgentActivity(event.sessionId, null);
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          }
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'session_started': {
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          break;
        }
        case 'session_ready': {
          store().setAgentActivity(event.session.id, null);
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          break;
        }
        case 'session_state_changed': {
          const stateMessages: Record<string, string> = {
            stopped: 'Session ended',
            crashed: 'Session crashed',
            interrupted: 'Session interrupted (server restart)',
          };
          const msg = stateMessages[event.state];
          if (msg) {
            store().appendChatMessage(event.sessionId, {
              id: crypto.randomUUID(),
              role: 'system',
              content: msg,
              eventType: 'status',
              timestamp: new Date().toISOString(),
            });
          }
          store().setAgentActivity(event.sessionId, null);
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'approval_requested': {
          store().addPendingApproval(event.approval);
          store().appendChatMessage(event.approval.sessionId, {
            id: `approval-${event.approval.id}`,
            role: 'system',
            content: `${event.approval.id}:${event.approval.status}:${event.approval.toolName}`,
            eventType: 'approval_request',
            timestamp: event.approval.createdAt,
          });
          store().setAgentActivity(event.approval.sessionId, `Waiting for approval: ${event.approval.toolName}`);
          store().markUnread(event.approval.sessionId);
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'approval_resolved': {
          store().resolvePendingApproval(event.approvalId, event.decision);
          const approval = store().pendingApprovals.find(a => a.id === event.approvalId);
          if (approval) store().setAgentActivity(approval.sessionId, null);
          break;
        }
        case 'config_options_updated': {
          store().setConfigOptions(event.sessionId, event.configOptions);
          break;
        }
        case 'available_commands': {
          store().setAvailableCommands(event.sessionId, event.commands);
          break;
        }
        case 'turn_cancelled': {
          store().setTurnInFlight(event.sessionId, false);
          store().appendChatMessage(event.sessionId, {
            id: crypto.randomUUID(),
            role: 'system',
            content: 'Turn cancelled',
            eventType: 'status',
            timestamp: new Date().toISOString(),
          });
          store().setAgentActivity(event.sessionId, null);
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          }
          break;
        }
        case 'turn_completed': {
          store().setTurnInFlight(event.sessionId, false);
          store().setAgentActivity(event.sessionId, null);
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'session_usage_update': {
          store().setSessionUsage(event.sessionId, event.usage);
          break;
        }
        case 'update_available': {
          useWsStore.getState().setUpdateAvailable(true);
          break;
        }
        case 'extensions_changed': {
          invalidateRendererCache();
          store().bumpPluginsRevision();
          break;
        }
        case 'server_restarting': {
          console.info('[sse] server is restarting...');
          break;
        }
      }
    });

    // On SSE reconnect (onerror → browser auto-reconnect → onopen fires again),
    // invalidate all queries so REST data is refreshed.
    const unsubConn = onConnectionChange((connected) => {
      store().setConnected(connected);
      if (connected) {
        queryClient.invalidateQueries();
      }
    });

    api.checkForUpdates().then(result => {
      if (result.should_notify) useWsStore.getState().setUpdateAvailable(true);
    }).catch((err) => { console.warn('[events-provider] initial update check failed:', err); });

    return () => {
      unsubEvent();
      unsubConn();
    };
  }, []);

  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/custom/events-provider.tsx
git commit -m "feat: add EventsProvider replacing WsProvider, using SSE instead of WebSocket"
```

---

## Task 6: Frontend — Update `App.tsx` and `main.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Update `App.tsx`**

Make these targeted changes to `App.tsx`:

1. Replace WS import:
```typescript
// Before:
import { disconnectWs } from './lib/ws';
// After:
import { disconnectSSE } from './lib/events';
```

2. Replace WsProvider import:
```typescript
// Before:
import { WsProvider } from './components/custom/ws-provider';
// After:
import { EventsProvider } from './components/custom/events-provider';
```

3. Remove ConnectionBanner import:
```typescript
// Delete this line:
import { ConnectionBanner } from './components/custom/connection-banner';
```

4. Replace `disconnectWs()` call:
```typescript
// Before:
disconnectWs()
// After:
disconnectSSE()
```

5. Replace `<WsProvider>` with `<EventsProvider>`:
```typescript
// Before:
<WsProvider>
  ...
</WsProvider>
// After:
<EventsProvider>
  ...
</EventsProvider>
```

6. Remove `<ConnectionBanner />` usage (wherever it appears in the JSX).

- [ ] **Step 2: Update `main.tsx`**

In `frontend/src/main.tsx`:

```typescript
// Before:
import { connectWs, subscribeWsEvent } from './lib/ws';

// After:
import { connectSSE, subscribeServerEvent } from './lib/events';
```

Change the call:
```typescript
// Before:
connectWs();
// After:
connectSSE();
```

Search for `subscribeWsEvent` usage in main.tsx and replace with `subscribeServerEvent`:
```typescript
// Before:
subscribeWsEvent(handler)
// After:
subscribeServerEvent(handler)
```

- [ ] **Step 3: Check for remaining `ws` imports**

```bash
grep -rn "from '@/lib/ws'\|from './lib/ws'\|from '../lib/ws'" frontend/src/ --include="*.tsx" --include="*.ts"
```

Expected: zero results (all moved to events).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx
git commit -m "refactor: update App.tsx and main.tsx to use SSE events module"
```

---

## Task 7: Frontend — Replace `sendClientEvent` with `fetch` POSTs

**Files:**
- Modify: `frontend/src/routes/index.tsx`
- Modify: `frontend/src/hooks/use-session-chat.ts`
- Modify: `frontend/src/components/custom/session-chat-panel.tsx`

All three files import `sendClientEvent` from `@/lib/ws`. Remove those imports and replace each call with a `fetch` to the new REST endpoints.

- [ ] **Step 1: Update `frontend/src/routes/index.tsx`**

Remove:
```typescript
import { sendClientEvent } from '@/lib/ws';
```

The file uses `sendClientEvent` in three places (around lines 102, 106, 140). Replace:

```typescript
// Line ~102 — approval decision
// Before:
sendClientEvent({ type: 'approval_response', approvalId: a.id, decision: d });
// After:
fetch(`/api/approvals/${a.id}/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: d }),
}).catch(console.error);
```

```typescript
// Line ~106 — respond to pending input
// Before:
sendClientEvent({ type: 'send_input', sessionId: input.sessionId, inputId: input.inputId, response: answer });
// After:
fetch(`/api/sessions/${input.sessionId}/inputs/${input.inputId}/respond`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ response: answer }),
}).catch(console.error);
```

```typescript
// Line ~140 — send message to idle session
// Before:
sendClientEvent({ type: 'send_message', sessionId: session.id, content: message });
// After:
fetch(`/api/sessions/${session.id}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: message }),
}).catch(console.error);
```

- [ ] **Step 2: Update `frontend/src/hooks/use-session-chat.ts`**

Remove:
```typescript
import { sendClientEvent } from '@/lib/ws';
```

Four call sites (around lines 186, 189, 205, 209). Replace:

```typescript
// Line ~186 — send_input from text input
// Before:
sendClientEvent({ type: 'send_input', sessionId, inputId, response: text });
// After:
fetch(`/api/sessions/${sessionId}/inputs/${inputId}/respond`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ response: text }),
}).catch(console.error);
```

```typescript
// Line ~189 — send_message from text input
// Before:
sendClientEvent({ type: 'send_message', sessionId, content: text });
// After:
fetch(`/api/sessions/${sessionId}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: text }),
}).catch(console.error);
```

```typescript
// Line ~205 — cancel_turn
// Before:
sendClientEvent({ type: 'cancel_turn', sessionId });
// After:
fetch(`/api/sessions/${sessionId}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).catch(console.error);
```

```typescript
// Line ~209 — approval_response
// Before:
sendClientEvent({ type: 'approval_response', approvalId, decision });
// After:
fetch(`/api/approvals/${approvalId}/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision }),
}).catch(console.error);
```

- [ ] **Step 3: Update `frontend/src/components/custom/session-chat-panel.tsx`**

Remove:
```typescript
import { sendClientEvent } from '@/lib/ws';
```

One call site (around line 104):

```typescript
// Before:
sendClientEvent({ type: 'set_config_option', sessionId: session.id, configId, value });
// After:
fetch(`/api/sessions/${session.id}/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ configId, value }),
}).catch(console.error);
```

Also remove the now-unused `connected` read from store (line 72) since the banner is gone and this component no longer needs it for gating:
```typescript
// Delete this line (only if it's not used elsewhere in the component):
const connected = useWsStore((s) => s.connected);
```

- [ ] **Step 4: Confirm no remaining sendClientEvent**

```bash
grep -rn "sendClientEvent\|from '@/lib/ws'\|from '../lib/ws'" frontend/src/ --include="*.tsx" --include="*.ts"
```

Expected: zero results.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/index.tsx frontend/src/hooks/use-session-chat.ts frontend/src/components/custom/session-chat-panel.tsx
git commit -m "refactor: replace sendClientEvent WS calls with fetch REST POSTs"
```

---

## Task 8: Frontend — Delete Dead Files

**Files:**
- Delete: `frontend/src/lib/ws.ts`
- Delete: `frontend/src/components/custom/ws-provider.tsx`
- Delete: `frontend/src/components/custom/connection-banner.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm frontend/src/lib/ws.ts
rm frontend/src/components/custom/ws-provider.tsx
rm frontend/src/components/custom/connection-banner.tsx
```

- [ ] **Step 2: Full TypeScript compile check**

```bash
cd frontend && bun run --bun tsc --noEmit 2>&1
```

Expected: zero errors. If there are import errors pointing to `ws.ts`, `ws-provider.tsx`, or `connection-banner.tsx` — those are missed usages; find and fix them.

- [ ] **Step 3: Full backend compile check**

```bash
cd backend && bun run --bun tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git rm frontend/src/lib/ws.ts frontend/src/components/custom/ws-provider.tsx frontend/src/components/custom/connection-banner.tsx
git commit -m "cleanup: delete ws.ts, WsProvider, and ConnectionBanner — replaced by SSE"
```

---

## Task 9: Integration Smoke Test

- [ ] **Step 1: Start the backend**

```bash
cd backend && bun run src/server.ts 2>&1 &
sleep 2
```

- [ ] **Step 2: Verify SSE endpoint delivers events**

```bash
# Terminal 1 — listen for SSE events
curl -N http://127.0.0.1:3000/api/events &
SSE_PID=$!

# Terminal 2 — trigger a task_updated event by creating a task
curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"SSE test task"}' | jq .

sleep 2
kill $SSE_PID
```

Expected: the SSE stream receives a `task_updated` event JSON line for the newly created task.

- [ ] **Step 3: Verify REST action endpoints**

```bash
# Send a message (session may not exist so 404 is expected — confirms route exists)
curl -s -X POST http://127.0.0.1:3000/api/sessions/test-id/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"hello"}' | jq .
# Expected: { "error": "...", "message": "..." } with 404 or 500 (not 404 on route — route exists)
```

- [ ] **Step 4: Start full dev stack and open browser**

```bash
pkill -f 'bun run src/server.ts'
bun run dev
```

Open `http://localhost:5173`. Verify:
1. No console errors about WebSocket connection
2. Network tab shows `GET /api/events` as an SSE request (type: eventsource)
3. Navigation and task list loads correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: SSE refactor complete — smoke tests pass"
```

---

## Self-Review Against Spec

| Spec Requirement | Covered by Task |
|-----------------|----------------|
| Remove Hono WebSocket setup from `app.ts` | Task 2 |
| `GET /api/events` with `?activeSessionId` param | Task 2 |
| Refactor `broadcast` to write to SSE streams | Task 2 |
| Filter heavy events by `activeSessionId` | Task 2 |
| Keep-alive ping every 15 seconds | Task 2 |
| `POST /api/sessions/:id/messages` | Task 1 |
| `POST /api/approvals/:id/resolve` | Task 1 |
| `POST /api/sessions/:id/cancel` | Task 1 |
| `POST /api/sessions/:id/inputs/:inputId/respond` | Task 1 |
| `POST /api/sessions/:id/config` | Task 1 |
| `POST /api/sessions/:id/terminal` | Task 1 |
| Rename `ws.ts` → `events.ts` | Task 4 |
| Replace `WebSocket` with `EventSource` | Task 4 |
| `subscribeToSession(id)` method | Task 4 |
| `EventSource.onmessage` dispatches to listeners | Task 4 |
| Replace all `sendClientEvent` with `fetch` POST | Task 7 |
| Delete `sendClientEvent` function | Task 4 + 8 |
| Delete `ClientEvent` type | Task 3 |
| Remove `ws-provider.tsx` | Task 8 |
| Remove WS connection state banners | Tasks 6 + 8 |
| Remove WS reconnection logic | Tasks 4 + 8 |
| Dashboard relies on REST for initial data | Already true (React Query) |
| SSE for real-time invalidations | Task 5 (`onConnectionChange` invalidates) |

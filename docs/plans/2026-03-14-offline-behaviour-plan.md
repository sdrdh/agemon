# Offline Behaviour & WebSocket Event Sequencing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seq/epoch tracking to WebSocket events, replay missed events on reconnect, detect server restarts and buffer overflow, and disable send/approval UI when offline.

**Architecture:** Backend injects monotonic `seq` and startup `epoch` into every broadcast event via a ring buffer in `app.ts`. On reconnect, client sends `resume` with `lastSeq`; server replays or sends `full_sync_required`. Frontend tracks `lastSeq`/`knownEpoch` in Zustand (no component subscriptions), disables inputs when `!connected`.

**Tech Stack:** Hono WebSocket (backend), Zustand + React Query (frontend), shared TypeScript types.

**Spec:** `docs/plans/2026-03-12-offline-behaviour-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/types/index.ts` | Modify | Add `seq`, `epoch` to `ServerEvent`; `resume` to `ClientEvent`; `full_sync_required` to `ServerEvent` |
| `backend/src/app.ts` | Modify | Ring buffer, seq counter, epoch, resume handler, full_sync_required; update `AppContext.broadcast` type |
| `frontend/src/lib/store.ts` | Modify | `lastSeq`, `knownEpoch`, `setLastSeq`, `setKnownEpoch`, `resetForFullSync` |
| `frontend/src/lib/ws.ts` | Modify | Send `resume` on open |
| `frontend/src/components/custom/ws-provider.tsx` | Modify | Track seq/epoch on every event; handle `full_sync_required`; detect epoch mismatch |
| `frontend/src/components/custom/session-chat-panel.tsx` | Modify | Read `connected` from store, pass to `ChatMessagesArea` and `ChatInputArea` |
| `frontend/src/components/custom/chat-input-area.tsx` | Modify | Accept+use `connected` prop |
| `frontend/src/components/custom/chat-messages-area.tsx` | Modify | Accept+pass `connected` prop to `ChatBubble` |
| `frontend/src/components/custom/chat-bubble.tsx` | Modify | Accept+pass `connected` prop to `ApprovalCard` |
| `frontend/src/components/custom/approval-card.tsx` | Modify | Accept+use `connected` prop |

---

## Chunk 1: Shared Types + Backend Ring Buffer

### Task 1: Add seq, epoch, resume, full_sync_required to shared types

**Files:**
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Add `seq` and `epoch` fields to the `ServerEvent` base**

The current `ServerEvent` is a discriminated union of plain objects. We need to add `seq` and `epoch` to every variant. The cleanest way: define a `ServerEventBase` and intersect it.

```ts
// Add before the ServerEvent union:
interface ServerEventBase {
  seq: number;
  epoch: string;
}

// Replace the existing ServerEvent union with intersected variants + full_sync_required:
export type ServerEvent =
  | (ServerEventBase & { type: 'task_updated'; task: Task })
  | (ServerEventBase & { type: 'agent_thought'; taskId: string; sessionId: string; content: string; eventType: 'thought' | 'action'; messageId?: string })
  | (ServerEventBase & { type: 'awaiting_input'; taskId: string; sessionId: string; question: string; inputId: string })
  | (ServerEventBase & { type: 'terminal_output'; sessionId: string; data: string })
  | (ServerEventBase & { type: 'session_started'; taskId: string; session: AgentSession })
  | (ServerEventBase & { type: 'session_ready'; taskId: string; session: AgentSession })
  | (ServerEventBase & { type: 'session_state_changed'; sessionId: string; taskId: string; state: AgentSessionState })
  | (ServerEventBase & { type: 'approval_requested'; approval: PendingApproval })
  | (ServerEventBase & { type: 'approval_resolved'; approvalId: string; decision: ApprovalDecision })
  | (ServerEventBase & { type: 'config_options_updated'; sessionId: string; taskId: string; configOptions: SessionConfigOption[] })
  | (ServerEventBase & { type: 'available_commands'; sessionId: string; taskId: string; commands: AgentCommand[] })
  | (ServerEventBase & { type: 'turn_cancelled'; sessionId: string; taskId: string })
  | (ServerEventBase & { type: 'turn_completed'; sessionId: string; taskId: string })
  | (ServerEventBase & { type: 'session_usage_update'; sessionId: string; taskId: string; usage: SessionUsage })
  | (ServerEventBase & { type: 'full_sync_required' });
```

- [ ] **Step 2: Add `resume` to `ClientEvent` union**

```ts
export type ClientEvent =
  | { type: 'send_input'; taskId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string }
  | { type: 'send_message'; sessionId: string; content: string }
  | { type: 'approval_response'; approvalId: string; decision: ApprovalDecision }
  | { type: 'set_config_option'; sessionId: string; configId: string; value: string }
  | { type: 'cancel_turn'; sessionId: string }
  | { type: 'resume'; lastSeq: number };
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: Type errors expected in `app.ts` (broadcast signature mismatch) — that's fine, we fix it in Task 2.

- [ ] **Step 4: Commit**

```bash
git add shared/types/index.ts
git commit -m "feat(types): add seq, epoch, resume, full_sync_required for offline behaviour"
```

---

### Task 2: Add ring buffer, seq counter, and epoch to backend broadcast

**Files:**
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Add epoch, globalSeq, ring buffer state**

At the top of `createApp()`, before the WebSocket setup:

```ts
// ─── Event Sequencing ───────────────────────────────────────────────────────
const epoch = Date.now().toString();
let globalSeq = 0;
const EVENT_RING_SIZE = 500;
const eventRing: ServerEvent[] = [];
let ringHead = 0;
```

- [ ] **Step 2: Update `AppContext.broadcast` type signature**

The `AppContext` interface currently declares `broadcast: (event: ServerEvent) => void`. Since `broadcast` now injects `seq` and `epoch`, callers should not provide them. Update the interface:

```ts
export interface AppContext {
  app: Hono;
  broadcast: (event: Omit<ServerEvent, 'seq' | 'epoch'>) => void;
  eventBus: EventEmitter;
  wsClients: Set<WSContext>;
}
```

- [ ] **Step 3: Modify `broadcast()` to inject seq + epoch and record in ring buffer**

Replace the existing `broadcast` function:

```ts
function broadcast(event: Omit<ServerEvent, 'seq' | 'epoch'>) {
  const seq = ++globalSeq;
  const e = { ...event, seq, epoch } as ServerEvent;
  eventRing[ringHead % EVENT_RING_SIZE] = e;
  ringHead++;
  const payload = JSON.stringify(e);
  for (const client of [...wsClients]) {
    if (client.readyState === WS_OPEN) client.send(payload);
  }
}
```

- [ ] **Step 4: Add `'resume'` to `WS_CLIENT_EVENT_TYPES`**

This prevents the `console.warn('[ws] unknown client event type: resume')` log. Even though `resume` is intercepted before the guard, adding it to the set keeps the type validation consistent:

```ts
const WS_CLIENT_EVENT_TYPES = new Set([
  'send_input', 'terminal_input', 'send_message', 'approval_response',
  'set_config_option', 'cancel_turn', 'resume',
]);
```

- [ ] **Step 5: Add `resume` handling in WS `onMessage`**

In the `onMessage` handler, before the existing `eventBus.emit` call, intercept `resume` events and handle them directly (connection-level concern — does NOT go through `eventBus`):

```ts
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

      // Check if lastSeq falls outside ring buffer (spec formula)
      const oldest = eventRing[ringHead % EVENT_RING_SIZE]?.seq ?? Infinity;
      if (lastSeq < oldest) {
        // Gap unrecoverable — tell client to refetch
        const syncEvent = { type: 'full_sync_required' as const, seq: globalSeq, epoch };
        ws.send(JSON.stringify(syncEvent));
        console.info(`[ws] sent full_sync_required (lastSeq=${lastSeq} < oldest=${oldest})`);
        return;
      }

      // Replay events with seq > lastSeq, in order
      const bufferLen = Math.min(ringHead, EVENT_RING_SIZE);
      let replayed = 0;
      for (let i = 0; i < bufferLen; i++) {
        const idx = (ringHead > EVENT_RING_SIZE ? ringHead + i : i) % EVENT_RING_SIZE;
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
    // ... rest of existing handler (eventBus.emit, etc.)
```

- [ ] **Step 6: Verify backend starts cleanly**

Run: `cd backend && AGEMON_KEY=test bun run src/server.ts`
Expected: Server starts, no errors. Ctrl+C to stop.

- [ ] **Step 7: Run smoke tests**

```bash
# Terminal 1:
cd backend && rm -f ~/.agemon/agemon.db* && AGEMON_KEY=test bun run src/server.ts

# Terminal 2:
./scripts/test-api.sh
```
Expected: All 21 tests pass. The smoke tests exercise REST endpoints; the new WS logic doesn't break them.

- [ ] **Step 8: Commit**

```bash
git add backend/src/app.ts
git commit -m "feat(backend): add ring buffer, seq counter, epoch, and resume handler"
```

---

## Chunk 2: Frontend Store + WS Reconnect Logic

### Task 3: Add lastSeq, knownEpoch, and resetForFullSync to Zustand store

**Files:**
- Modify: `frontend/src/lib/store.ts`

- [ ] **Step 1: Add state fields and actions to the WsState interface**

Add to the interface (after `toolCalls`):

```ts
/** Last received server event sequence number (internal bookkeeping, not subscribed by components) */
lastSeq: number;
/** Server epoch string (internal bookkeeping, not subscribed by components) */
knownEpoch: string;
setLastSeq: (seq: number) => void;
setKnownEpoch: (epoch: string) => void;
/** Reset store state for full resync (epoch mismatch or buffer overflow) */
resetForFullSync: () => void;
```

- [ ] **Step 2: Add initial values and action implementations**

In the `create<WsState>` call, add initial values:

```ts
lastSeq: 0,
knownEpoch: '',
```

Add action implementations:

```ts
setLastSeq: (seq) => set({ lastSeq: seq }),
setKnownEpoch: (epoch) => set({ knownEpoch: epoch }),
resetForFullSync: () => set({
  chatMessages: {},
  pendingInputs: [],
  pendingApprovals: [],
  agentActivity: {},
  unreadSessions: {},
  toolCalls: {},
  turnsInFlight: {},
  configOptions: {},
  availableCommands: {},
  sessionUsage: {},
  lastSeq: 0,
  knownEpoch: '',
}),
```

Note: `unreadSessions` is included in the reset — stale unread badges would persist after resync otherwise.

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/store.ts
git commit -m "feat(store): add lastSeq, knownEpoch, resetForFullSync for offline behaviour"
```

---

### Task 4: Send `resume` on WS reconnect

**Files:**
- Modify: `frontend/src/lib/ws.ts`

- [ ] **Step 1: Import the store and send resume on open**

Add import at top:

```ts
import { useWsStore } from '@/lib/store';
```

In `connectWs()`, modify the `socket.onopen` handler:

```ts
socket.onopen = () => {
  reconnectDelay = 1_000;
  setConnected(true);

  // Send resume if we have a lastSeq (reconnecting, not first connect).
  // Invariant: lastSeq === 0 on first connect, so resume is never sent on page load.
  // This is important — a fresh client should not trigger replay of the entire ring buffer.
  const { lastSeq } = useWsStore.getState();
  if (lastSeq > 0) {
    socket!.send(JSON.stringify({ type: 'resume', lastSeq }));
    console.info(`[ws] sent resume, lastSeq=${lastSeq}`);
  }
};
```

Note: `useWsStore.getState()` is called outside React — this is the correct Zustand pattern for non-component code. No subscription, no re-renders.

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/ws.ts
git commit -m "feat(ws): send resume with lastSeq on reconnect"
```

---

### Task 5: Track seq/epoch on every event + handle full_sync_required

**Files:**
- Modify: `frontend/src/components/custom/ws-provider.tsx`

- [ ] **Step 1: Track seq and epoch on every incoming event**

At the very top of the `onServerEvent` callback (before the `switch`), add seq/epoch tracking and epoch-mismatch detection:

```ts
const unsubEvent = onServerEvent((event: ServerEvent) => {
  // ── Seq/epoch bookkeeping (before business logic) ─────────────────────
  if (typeof event.seq === 'number') {
    store().setLastSeq(event.seq);
  }
  if (event.epoch) {
    const known = store().knownEpoch;
    if (known && event.epoch !== known) {
      // Server restarted — full resync. The first event after restart is
      // intentionally dropped: queryClient.invalidateQueries() triggers REST
      // refetches that will bring all fresh data including what this event carried.
      console.info('[ws] epoch mismatch detected, triggering full resync');
      store().resetForFullSync();
      store().setLastSeq(event.seq);
      store().setKnownEpoch(event.epoch);
      queryClient.invalidateQueries();
      return;
    }
    if (!known) {
      store().setKnownEpoch(event.epoch);
    }
  }

  switch (event.type) {
    // ... existing cases
```

- [ ] **Step 2: Add `full_sync_required` case to the switch**

```ts
case 'full_sync_required': {
  console.info('[ws] full_sync_required received, triggering full resync');
  store().resetForFullSync();
  store().setLastSeq(event.seq);
  store().setKnownEpoch(event.epoch);
  queryClient.invalidateQueries();
  break;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/custom/ws-provider.tsx
git commit -m "feat(ws-provider): track seq/epoch, handle full_sync_required and epoch mismatch"
```

---

## Chunk 3: Disable Inputs When Offline

### Task 6: Disable chat input when offline

**Files:**
- Modify: `frontend/src/components/custom/chat-input-area.tsx`
- Modify: `frontend/src/components/custom/session-chat-panel.tsx`

- [ ] **Step 1: Add `connected` prop to `ChatInputArea`**

In `chat-input-area.tsx`, add to the props interface and destructure:

```ts
export function ChatInputArea({
  connected,        // ← add
  sessionStopped,
  // ... rest
}: {
  connected: boolean;  // ← add
  sessionStopped: boolean;
  // ... rest
```

- [ ] **Step 2: Use `connected` in the disabled logic**

The textarea currently uses `disabled={!canType && !sessionReady}`. Change to:

```ts
disabled={!connected || (!canType && !sessionReady)}
```

The send button currently uses `disabled={(!canType && !sessionReady) || !inputText.trim()}`. Change to:

```ts
disabled={!connected || (!canType && !sessionReady) || !inputText.trim()}
```

The cancel-turn button should also be disabled when offline:

```ts
<Button
  type="button"
  size="icon"
  variant="destructive"
  onClick={onCancelTurn}
  disabled={!connected}
  className="min-h-[44px] min-w-[44px]"
  aria-label="Cancel turn"
>
```

**Important:** The textarea `value` is NOT cleared on disconnect. The `inputText` state lives in the parent (`session-chat-panel.tsx`) and persists across connection changes. Users keep their drafted text.

- [ ] **Step 3: Pass `connected` from `SessionChatPanel`**

In `session-chat-panel.tsx`, read connected from the store and pass it:

```ts
const connected = useWsStore((s) => s.connected);
```

Then pass to `ChatInputArea`:

```tsx
<ChatInputArea
  connected={connected}
  sessionStopped={sessionStopped}
  // ... rest of existing props
```

- [ ] **Step 4: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/custom/chat-input-area.tsx frontend/src/components/custom/session-chat-panel.tsx
git commit -m "feat(chat-input): disable send/input when offline"
```

---

### Task 7: Disable approval buttons when offline

The `connected` prop must be threaded through the full component chain:
`SessionChatPanel` → `ChatMessagesArea` → `ChatBubble` → `ApprovalCard`

**Files:**
- Modify: `frontend/src/components/custom/approval-card.tsx`
- Modify: `frontend/src/components/custom/chat-bubble.tsx`
- Modify: `frontend/src/components/custom/chat-messages-area.tsx`
- Modify: `frontend/src/components/custom/session-chat-panel.tsx` (already has `connected` from Task 6)

- [ ] **Step 1: Add `connected` prop to `ApprovalCard`**

```ts
interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (approvalId: string, decision: ApprovalDecision) => void;
  connected: boolean;  // ← add
}

export function ApprovalCard({ approval, onDecision, connected }: ApprovalCardProps) {
```

- [ ] **Step 2: Merge `connected` into button disabled logic**

Each of the three buttons (Allow, Always, Deny) currently has `disabled={submitting}`. Change all three to:

```ts
disabled={submitting || !connected}
```

- [ ] **Step 3: Add `connected` prop to `ChatBubble`**

In `chat-bubble.tsx`, add `connected: boolean` to the props interface. Pass it through to `ApprovalCard`:

```tsx
<ApprovalCard approval={approval} onDecision={onDecision} connected={connected} />
```

- [ ] **Step 4: Add `connected` prop to `ChatMessagesArea`**

In `chat-messages-area.tsx`, add `connected: boolean` to the props interface. Pass it through to each `ChatBubble`:

```tsx
<ChatBubble ... connected={connected} />
```

- [ ] **Step 5: Pass `connected` from `SessionChatPanel` to `ChatMessagesArea`**

In `session-chat-panel.tsx` (which already has `const connected = useWsStore((s) => s.connected)` from Task 6), pass it to `ChatMessagesArea`:

```tsx
<ChatMessagesArea
  ...
  connected={connected}
/>
```

- [ ] **Step 6: Verify types compile**

Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/custom/approval-card.tsx frontend/src/components/custom/chat-bubble.tsx frontend/src/components/custom/chat-messages-area.tsx frontend/src/components/custom/session-chat-panel.tsx
git commit -m "feat(approval-card): disable approve/reject/always buttons when offline"
```

---

## Chunk 4: Verification

### Task 8: Run smoke tests and verify acceptance criteria

- [ ] **Step 1: Run backend smoke tests**

```bash
# Terminal 1:
cd backend && rm -f ~/.agemon/agemon.db* && AGEMON_KEY=test bun run src/server.ts

# Terminal 2:
./scripts/test-api.sh
```
Expected: All tests pass.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && node_modules/.bin/tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 3: Manual verification checklist**

Start backend + frontend dev servers:
```bash
# Terminal 1:
cd backend && AGEMON_KEY=test bun run src/server.ts

# Terminal 2:
cd frontend && bun run dev
```

Verify:
- [ ] Send button disabled and visually muted when WS disconnected (kill backend, observe UI)
- [ ] Approval buttons disabled when WS disconnected
- [ ] Drafted text preserved in textarea when connection drops
- [ ] On reconnect (restart backend): full resync triggered (epoch mismatch)
- [ ] Browsing between task chats works while backend is down
- [ ] Existing functionality (send message, approve tool, slash commands) still works when connected
- [ ] On initial page load, no `resume` event is sent (check DevTools Network/WS tab — only normal events should appear, not a `resume` frame)

- [ ] **Step 4: Mark task 4.32 as done**

In `docs/tasks/phase-4-5-session-ux.md`, find task 4.32 and mark it done.

- [ ] **Step 5: Final commit**

```bash
git add docs/tasks/phase-4-5-session-ux.md
git commit -m "feat: complete task 4.32 — offline behaviour and WebSocket event sequencing"
```

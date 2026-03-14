# Offline Behaviour & WebSocket Event Sequencing

**Date:** 2026-03-12
**Status:** Approved (revised 2026-03-14)

---

## Problem

When the WebSocket disconnects (mobile signal loss, server restart, network flap):

1. Any text typed in the chat input or approval form is lost — the send button fires into the void and the textarea clears.
2. Events emitted by the server during the disconnect window are silently missed — on reconnect, Agemon refetches full chat history but the gap between last-known event and reconnect is dropped.
3. Navigation between chats is blocked by the blank/stale state since the store is in-memory only.

---

## Approach

**Block sends, not queue them.** Disable send and approval buttons while `connected === false`. Users can still browse and read all loaded chat history. When connection is restored, inputs re-enable.

**Replay missed events on reconnect.** The server assigns a monotonic `seq` number to every `ServerEvent`. On reconnect the client sends its `lastSeq`; the server replays all events from a ring buffer that are `> lastSeq`. No full refetch needed.

**Detect server restarts via epoch.** Every `ServerEvent` carries an `epoch` string (set once at server startup). If the client detects a new epoch on reconnect, it skips the resume handshake and triggers a full REST refetch instead.

**Handle buffer overflow gracefully.** If the client's `lastSeq` is older than the ring buffer's oldest entry, the server sends `full_sync_required` and the client does a full refetch.

This is the Shelley/OpenClaw pattern documented in `docs/reference-repo-analysis.md` §2.

---

## Design

### Backend

**1. Sequence counter + epoch**

Global atomic counter and epoch string in `app.ts` inside `createApp()`. Increments on every broadcast. Epoch is set once at startup.

```ts
// app.ts
const epoch = Date.now().toString();
let globalSeq = 0;
```

Every `ServerEvent` gets `seq` and `epoch` injected by the broadcast function.

**2. Ring buffer**

In-memory circular buffer of the last 500 events. Stored in `app.ts` alongside the WS connection map. No persistence needed — events are ephemeral.

```ts
const EVENT_RING_SIZE = 500;
const eventRing: (ServerEvent & { seq: number; epoch: string })[] = [];
let ringHead = 0;

function broadcast(event: ServerEvent) {
  const seq = ++globalSeq;
  const e = { ...event, seq, epoch };
  eventRing[ringHead % EVENT_RING_SIZE] = e;
  ringHead++;
  // send to all connected WS clients
}
```

**3. Resume handshake**

New client event type:

```ts
// shared/types/index.ts — ClientEvent union
| { type: 'resume'; lastSeq: number }
```

Handled directly in the WS `onMessage` handler in `app.ts` (connection-level concern, not a business event — does NOT go through `eventBus`).

On receiving `resume`:
1. Check if `lastSeq` falls outside the ring buffer (older than oldest entry).
2. If gap is unrecoverable → send `{ type: 'full_sync_required', seq: globalSeq, epoch }` to that client only.
3. Otherwise → replay all ring buffer events with `seq > lastSeq` in order to that client only.

```ts
const oldest = eventRing[ringHead % EVENT_RING_SIZE]?.seq ?? Infinity;
if (lastSeq < oldest) {
  send(ws, { type: 'full_sync_required', seq: globalSeq, epoch });
  return;
}
```

---

### Frontend

**1. Track `lastSeq` and `knownEpoch` in Zustand store**

```ts
// store.ts
lastSeq: number;       // updated on every received ServerEvent
knownEpoch: string;    // updated on every received ServerEvent
```

These are internal bookkeeping — no components subscribe to them. Access via `useWsStore.getState()` only (follows `rerender-defer-reads` pattern).

**2. Send `resume` on reconnect + detect epoch mismatch**

In `ws.ts`, on socket `onopen`:
1. Read `lastSeq` and `knownEpoch` from `useWsStore.getState()`.
2. If `lastSeq > 0`, send `{ type: 'resume', lastSeq }`.
3. On first event received after reconnect, check `event.epoch !== knownEpoch`. If mismatch → server restarted → reset `lastSeq` to 0, trigger full REST refetch.

**3. Handle `full_sync_required`**

In `ws-provider.tsx`, on receiving `full_sync_required`:
- Invalidate all React Query caches (`queryClient.invalidateQueries()`) which triggers automatic refetches.
- Clear Zustand chat messages for a clean slate.
- Reset `lastSeq` to the received `seq`, set `knownEpoch` to the received `epoch`.

**4. Disable inputs when offline**

- `chat-input-area.tsx`: accept `connected` prop, disable textarea and send button when `!connected`
- `session-chat-panel.tsx`: read `connected` from store, pass to `ChatInputArea`
- `approval-card.tsx`: accept `connected` prop, disable approve/reject/always buttons when `!connected`
- Drafted text is preserved in the textarea — the input is not cleared on disconnect

**5. Navigation stays functional**

No change needed — the Zustand store is local, routing is client-side, and REST fetches for task/session lists already show cached data via React Query. Users can browse freely while offline.

---

## React Best Practices Applied

- **`rerender-defer-reads`** — `lastSeq` and `knownEpoch` are only read inside callbacks (`ws.ts` onopen), never during render. Accessed via `getState()`, not subscribed.
- **`rerender-derived-state`** — Components subscribe to `connected: boolean`, not raw socket state.
- **No unnecessary re-renders from seq tracking** — `lastSeq` updates on every WS event but zero components subscribe to it.

---

## Scope

| Area | Change |
|------|--------|
| `shared/types/index.ts` | Add `seq` + `epoch` to `ServerEvent`; add `resume` to `ClientEvent`; add `full_sync_required` to `ServerEvent` |
| `backend/src/app.ts` | Ring buffer, seq counter, epoch, inject into broadcast; handle `resume` in WS `onMessage`; send `full_sync_required` on gap |
| `frontend/src/lib/store.ts` | Add `lastSeq`, `knownEpoch`, `setLastSeq`, `setKnownEpoch`, `resetForFullSync` |
| `frontend/src/lib/ws.ts` | Send `resume` on open |
| `frontend/src/components/custom/ws-provider.tsx` | Track `lastSeq`/`knownEpoch` on every event; handle `full_sync_required` |
| `frontend/src/components/custom/session-chat-panel.tsx` | Pass `connected` to `ChatInputArea` |
| `frontend/src/components/custom/chat-input-area.tsx` | Accept `connected` prop, disable inputs when `!connected` |
| `frontend/src/components/custom/approval-card.tsx` | Accept `connected` prop, disable buttons when `!connected` |

---

## Out of Scope

- Persisting `lastSeq` across page reloads (IndexedDB) — ring buffer covers brief disconnects; full reload already refetches via REST
- Queuing messages for later send — block is simpler and safer
- Per-task or per-session sequencing — global seq is sufficient and simpler

---

## Acceptance Criteria

- [ ] Send button disabled and visually muted when `connected === false`
- [ ] Approval buttons disabled when `connected === false`
- [ ] Existing drafted text preserved in input when connection drops (not cleared)
- [ ] On reconnect (same server): missed events replayed without duplicates
- [ ] On reconnect (server restarted, epoch mismatch): full REST refetch triggered
- [ ] On reconnect (gap overflowed buffer): `full_sync_required` triggers full REST refetch
- [ ] Browsing between task chats works while offline
- [ ] Existing smoke tests pass (`scripts/test-api.sh`)

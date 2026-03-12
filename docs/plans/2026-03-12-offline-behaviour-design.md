# Offline Behaviour & WebSocket Event Sequencing

**Date:** 2026-03-12
**Status:** Approved

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

This is the Shelley/OpenClaw pattern documented in `docs/reference-repo-analysis.md` §2.

---

## Design

### Backend

**1. Sequence counter**

Global atomic counter in `server.ts`. Increments on every broadcast.

```ts
// shared/types/index.ts
type ServerEvent = {
  seq: number;   // added — monotonic, server-global
  type: string;
  payload: unknown;
};
```

**2. Ring buffer**

In-memory circular buffer of the last 500 events (configurable). Stored in `server.ts` alongside the WS connection map. No persistence needed — events are ephemeral.

```ts
const EVENT_RING_SIZE = 500;
const eventRing: ServerEvent[] = [];
let ringHead = 0;

function broadcast(event: Omit<ServerEvent, 'seq'>) {
  const seq = ++globalSeq;
  const e: ServerEvent = { seq, ...event };
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

On receiving `resume`, the server finds all ring buffer events with `seq > lastSeq` (in order) and sends them to that client only.

---

### Frontend

**1. Track `lastSeq` in Zustand store**

```ts
// store.ts
lastSeq: number;  // updated on every received ServerEvent
```

**2. Send `resume` on reconnect**

In `ws.ts`, after the socket opens, send `{ type: 'resume', lastSeq }` if `lastSeq > 0`. The server replays missed events; deduplication is handled by the existing `msg.id` dedup logic in `ws-provider.tsx`.

**3. Disable inputs when offline**

- `session-chat-panel.tsx`: disable textarea and send button when `!connected`
- `approval-card.tsx`: disable approve/reject buttons when `!connected`
- Show a subtle `"offline"` label on disabled inputs (not a full banner — the existing connection banner already covers that)

**4. Navigation stays functional**

No change needed — the Zustand store is local, routing is client-side, and REST fetches for task/session lists already show cached data via React Query. Users can browse freely while offline.

---

## Scope

| Area | Change |
|------|--------|
| `shared/types/index.ts` | Add `seq` to `ServerEvent`; add `resume` to `ClientEvent` |
| `backend/src/server.ts` | Ring buffer, seq counter, `resume` handler |
| `frontend/src/lib/store.ts` | Add `lastSeq: number` |
| `frontend/src/lib/ws.ts` | Send `resume` on open; update `lastSeq` on every event |
| `frontend/src/components/custom/session-chat-panel.tsx` | Disable inputs when `!connected` |
| `frontend/src/components/custom/approval-card.tsx` | Disable buttons when `!connected` |

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
- [ ] On reconnect, missed events are replayed without duplicates in chat
- [ ] Browsing between task chats works while offline
- [ ] Existing smoke tests pass (`scripts/test-api.sh`)

# Plugin System v2 — JSONL Events

## Why Replace the acp_events Table?

ACP events are append-only by nature. SQLite is the wrong tool:
- B-tree overhead and index maintenance for write-heavy, read-once data
- Binary file you can't grep, cat, or tail
- WAL mode still adds ~0.5ms per event write
- Sessions with thousands of events bloat the main DB

JSONL fits the actual access pattern:
- Each event is an append (~0.05ms, OS-level)
- Full session replay = sequential file read (cache-friendly)
- Debug = `tail -f ~/.agemon/sessions/{id}/events.jsonl`
- grep for specific tool calls, errors, or content directly

**Reference:** pi-mono uses JSONL files for session history (`packages/coding-agent/src/core/session-manager.ts`). Same reasoning.

---

## New Layout

```
~/.agemon/sessions/{timestamp}_{sessionId}/
  events.jsonl    ← append-only ACP event stream
  meta.json       ← session metadata snapshot
```

The `{timestamp}_` prefix enables chronological directory listing without `stat()` calls — useful for memory-cms, session browser, and recovery where the DB may be unavailable.

`meta.json` is a snapshot written at session start:
```json
{
  "sessionId": "...",
  "agentType": "claude-code",
  "startedAt": "2026-03-20T09:00:00Z",
  "cwd": "/Users/...",
  "meta": { "taskId": "..." }
}
```

---

## Event Format

```jsonl
{"id":"e1","type":"thought","content":"I should read the file first.","ts":"2026-03-20T09:00:01Z"}
{"id":"e2","type":"action","content":"{\"tool\":\"Read\",\"input\":{\"file_path\":\"/foo.ts\"}}","ts":"2026-03-20T09:00:02Z"}
{"id":"e3","type":"action_result","ref_id":"e2","content":"{\"output\":\"...file contents...\"}","ts":"2026-03-20T09:00:03Z"}
{"id":"e4","type":"await_input","question":"Should I proceed with the rename?","ts":"2026-03-20T09:00:10Z"}
{"id":"e5","type":"input_response","ref_id":"e4","response":"yes","ts":"2026-03-20T09:00:25Z"}
{"id":"e6","type":"result","content":"Done. Renamed Foo to Bar in 3 files.","ts":"2026-03-20T09:00:30Z"}
```

**Pending input** = last `await_input` event with no matching `input_response` event (matching via `ref_id`). State is derived from the log, held in memory, rebuilt on startup via JSONL replay.

**Approval events** (new in v2):
```jsonl
{"id":"e7","type":"approval_requested","tool":"Bash","input":{"command":"rm -rf dist/"},"ts":"..."}
{"id":"e8","type":"approval_resolved","ref_id":"e7","decision":"approved","ts":"..."}
```

---

## In-Memory Projection (awaiting_input)

The `awaiting_input` table is dropped from SQLite. Instead:

On server startup, for each `events.jsonl` where the session's DB state is `running` or `ready`:
1. Replay events
2. Find last `await_input` with no matching `input_response`
3. If found → session has pending input, rebuild in-memory map `{ sessionId → { questionId, question } }`

The in-memory map is the source of truth for pending inputs. It's updated live as new events are appended during active sessions.

---

## WebSocket Replay on Client Connect

The byte-offset scheme eliminates deduplication:

```
Client                           Server
──────                           ──────
GET /sessions/:id/events    →    reads events.jsonl → returns array
                            ←    [...events] + X-Offset: 48291
render all events
connect WebSocket           →
subscribe { sessionId,           reads from byte 48291 to EOF (gap fill)
  fromOffset: 48291 }      ←    switch to live append notifications
```

`X-Offset` = file byte size at REST response time. WS subscription starts from that exact byte offset. No ring buffer needed. No deduplication needed. No seq numbers.

---

## Checkpoint for Fast Startup

**Problem:** replaying all JSONL files on startup is O(events-total). With 500+ sessions, this compounds.

**Solution:** `meta.json` gets an optional `checkpoint` field updated when a session cleanly ends:

```json
{
  "sessionId": "...",
  "startedAt": "...",
  "endedAt": "2026-03-20T09:00:30Z",
  "checkpoint": {
    "pendingInputId": null,
    "pendingApprovalId": null,
    "state": "stopped"
  }
}
```

On startup, sessions with a clean `checkpoint` are O(1) — just read `meta.json`. Only sessions without a checkpoint (crashed, server went down mid-session) need JSONL replay. In practice this means only a handful of sessions need replay.

---

## Cross-Session Queries

The original v2 design acknowledged: "Cross-session query — slow → moves to in-memory projection."

More precisely, cross-session queries belong in **plugin-owned SQLite**, not in core. The tasks plugin, for example, maintains its own `task_sessions` table mapping `taskId → sessionId[]`. When it needs "all sessions for this task", it queries its own DB — not by scanning JSONL files.

Core JSONL is session-scoped. Plugins that need cross-session queries project the events they care about into their own SQLite.

---

## Migration from acp_events Table

Keep `acp_events` table read-only during transition:
- New sessions write to JSONL only
- Old sessions are readable from SQLite
- `/api/sessions/:id/events` checks: if JSONL file exists, use it; else fall back to SQLite rows
- Remove the fallback + table after one release cycle

---

## Performance Comparison

| Operation | SQLite | JSONL |
|-----------|--------|-------|
| Write one event | ~0.5ms (WAL + index) | ~0.05ms (append) |
| Read full session | fast (indexed scan) | fast (sequential read) |
| Cross-session query | fast (SQL join) | slow → plugin SQLite |
| Startup recovery | SQL query | file replay (checkpoint makes it O(1)) |
| Debug / grep | binary format | `grep "type:\"action\"" events.jsonl` |
| Backup | `cp agemon.db` | `cp -r sessions/` |

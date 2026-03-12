# Tool Call UI — Rich Per-Tool Cards

**Date:** 2026-03-12
**Status:** Approved
**Reference:** Shelley `ui/src/components/` — `.reference_repos/shelley/ui/src/components/`

---

## Problem

Tool calls are currently rendered as transient text in a spinner bar (`agentActivity` string). Once the tool completes, the activity clears — no persistent record in chat, no inputs visible, no output, no timing, no error details. Users can't see what the agent did or why something failed.

---

## Approach

Make tool calls first-class chat items. Each tool call gets a collapsible card inline in the chat stream — visible while running and after completion. Modelled on Shelley's `GenericTool` / `BashTool` / `PatchTool` pattern.

---

## Design

### Shared Types (`shared/types/index.ts`)

`ToolCallEvent` and `ToolCallUpdateEvent` already exist. Wire them into `ServerEvent`:

```ts
// Add to ServerEvent union:
| { type: 'tool_call'; sessionId: string; payload: ToolCallEvent }
| { type: 'tool_call_update'; sessionId: string; payload: ToolCallUpdateEvent }
```

`ToolCallEvent` carries: `toolCallId`, `kind`, `title`, `status`, `args`, `startedAt`
`ToolCallUpdateEvent` carries: `toolCallId`, `status`, `output?`, `error?`, `completedAt?`

### Backend (`backend/src/lib/acp.ts` or wherever ACP events are handled)

The ACP protocol sends tool call lifecycle events. The `parseToolActivity()` function in ws-provider already extracts tool name + args from the raw content. The backend needs to:

1. Parse ACP `tool_call_start` / `tool_call_end` (or equivalent) notifications
2. Emit structured `tool_call` and `tool_call_update` ServerEvents with all available fields
3. Include `startedAt` / `completedAt` timestamps for execution time calculation

No DB schema changes needed — tool calls are ephemeral (not stored in `acp_events`).

### Frontend Store (`frontend/src/lib/store.ts`)

```ts
// Add to WsState:
toolCalls: Record<string, ToolCall[]>  // keyed by sessionId
```

```ts
interface ToolCall {
  toolCallId: string;
  kind: string;           // 'Bash', 'Read', 'Edit', 'Write', 'Grep', 'Agent', etc.
  title: string;          // display title from ACP
  args?: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
```

Handle in `ws-provider.tsx`:
- `tool_call` → upsert into `toolCalls[sessionId]`
- `tool_call_update` → update existing entry by `toolCallId`

### Chat Item Integration (`frontend/src/lib/chat-utils.ts`)

Add a new kind to the `ChatItem` union:

```ts
| { kind: 'tool-call'; toolCall: ToolCall }
```

The chat item builder in `session-chat-panel.tsx` should interleave tool call items between thought/message items based on their `startedAt` timestamp.

### ToolCallCard Component (`frontend/src/components/custom/tool-call-card.tsx`)

Collapsible card, collapses by default. Same structure for all tools — specialization comes from how `title` and `args` are formatted.

**Header (always visible):**
- Status icon: spinner (in_progress) → ✓ (completed) → ✗ (failed)
- Tool kind label: `bash`, `edit`, `read`, etc.
- Primary info: `title` truncated to ~80 chars (already formatted by ACP, e.g. "Read src/server.ts")
- Execution time: `completedAt - startedAt`, shown as `340ms` or `1.2s` when complete

**Detail panel (collapsed by default, expand on click):**
- Args as formatted key-value pairs
- Output (if any) in a `<pre>` block
- Error message highlighted in red

**Specializations (same component, conditional rendering based on `kind`):**
- `Bash` — args.command as `<code>`, full output in scrollable pre
- `Edit` / `Write` / `Patch` — show filepath from args; diff viewer deferred to Pattern 8
- `Read` / `Glob` / `Grep` — show path/pattern from args
- All others — generic args JSON + output text

No separate `BashCard`, `EditCard` etc. — one component with `switch (kind)` sections for the header summary line only.

---

## Scope

| Area | Change |
|------|--------|
| `shared/types/index.ts` | Add `tool_call` / `tool_call_update` to `ServerEvent` union |
| `backend/src/lib/acp.ts` | Emit structured tool call events from ACP handler |
| `frontend/src/lib/store.ts` | Add `toolCalls: Record<string, ToolCall[]>` |
| `frontend/src/components/custom/ws-provider.tsx` | Handle new event types |
| `frontend/src/lib/chat-utils.ts` | Add `tool-call` ChatItem kind; interleave by timestamp |
| `frontend/src/components/custom/tool-call-card.tsx` | New component |
| `frontend/src/components/custom/session-chat-panel.tsx` | Render `tool-call` items; remove activity spinner (or keep as fallback) |

---

## Out of Scope

- Diff viewer for file edits (deferred to Pattern 8 / `display_content`)
- Persisting tool calls to `acp_events` DB (ephemeral, reconstructed from WS events)
- Tool call history on page reload (cleared on reconnect; full reload shows empty)

---

## Acceptance Criteria

- [ ] Tool calls appear inline in chat as collapsible cards while running
- [ ] Card updates in-place when tool completes (no duplicate, no flicker)
- [ ] Execution time shown on completed cards
- [ ] Failed tools show error message in card, ✗ in header
- [ ] Activity spinner removed or kept only as fallback for unknown event types
- [ ] Mobile: cards touch-friendly, collapse/expand works on tap
- [ ] Existing smoke tests pass

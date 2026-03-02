# Design: WebSocket Real-Time + ACP JSON-RPC + Git Worktrees

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Tasks 1.4, 4.1/4.3, 3.1

---

## Context

PR #3 landed core infrastructure: Hono server, bun:sqlite schema v3, REST API, frontend views, and ACP process spawning. Three critical gaps remain:

1. **Frontend is disconnected** — backend broadcasts WebSocket events, frontend has `ws.ts` with `onServerEvent()`, but no route subscribes. Views fetch once on mount and go stale.
2. **ACP is half-built** — stdin is piped but never written to. No JSON-RPC handshake. Agents start but sit idle or exit immediately.
3. **No git isolation** — agents need worktrees per task per repo. Nothing creates them yet.

These three streams are independent and will be built in parallel.

---

## Stream A: WebSocket Real-Time + State Management (Task 1.4)

### Approach: TanStack Query + Zustand

- **TanStack Query** handles server state: task lists, task details, events. Provides caching, dedup, stale-while-revalidate.
- **Zustand** handles ephemeral WebSocket state: live thought streams, connection status, pending input prompts.
- **Global WS listener** bridges the two: a React provider subscribes to `onServerEvent()` and dispatches to both layers.

### Event → State Mapping

| ServerEvent | Action |
|---|---|
| `task_updated` | `queryClient.setQueryData(['task', id], task)` + invalidate list queries |
| `agent_thought` | Append to Zustand `thoughts[taskId]` buffer |
| `awaiting_input` | Push to Zustand `pendingInputs` + invalidate task query |
| `session_started` | Invalidate task query |
| `session_state_changed` | Invalidate task query |

### Files

| File | Purpose |
|---|---|
| `frontend/src/lib/query.ts` | QueryClient singleton, query key factories |
| `frontend/src/lib/store.ts` | Zustand store: thoughts, connection, pending inputs |
| `frontend/src/components/custom/ws-provider.tsx` | React context connecting WS → TQ + Zustand |
| `frontend/src/routes/index.tsx` | Swap manual fetch for `useQuery(tasksByProjectQuery)` |
| `frontend/src/routes/tasks.$id.tsx` | `useQuery` for task + Zustand subscription for thoughts |
| `frontend/src/App.tsx` | Wrap router in `QueryClientProvider` + `WsProvider` |

### Backend Changes

- Wire `send_input` client event handler in `server.ts`: look up `awaiting_input` row, call `answerInput()`, write response to agent stdin, broadcast `task_updated`.
- No other backend changes needed — broadcast infrastructure already works.

---

## Stream B: ACP JSON-RPC 2.0 (Tasks 4.1/4.3)

### Approach: JSON-RPC Transport Layer + ACP Client Rewrite

Build a generic JSON-RPC 2.0 transport, then use it in a rewritten `acp.ts`.

### JSON-RPC Transport (`lib/jsonrpc.ts`)

Handles:
- Newline-delimited JSON framing on stdin/stdout
- Request/response correlation by `id` (auto-incrementing)
- Notification dispatch (no `id` field)
- Timeout on requests (configurable, default 30s)

```typescript
class JsonRpcTransport {
  constructor(stdin: WritableStream, stdout: ReadableStream)
  request(method: string, params?: any): Promise<any>  // sends request, awaits response by id
  notify(method: string, params?: any): void            // sends notification (no id)
  onNotification(handler: (method: string, params: any) => void): void
  close(): void
}
```

### ACP Lifecycle (rewritten `acp.ts`)

1. **Spawn** — `Bun.spawn()` with `stdin: 'pipe'`, `stdout: 'pipe'`, agent-specific command + env
2. **Initialize** — `transport.request('initialize', { clientInfo: { name: 'agemon', version: '1.0.0' } })`
3. **Set session** — `transport.notify('acp/setSessionInfo', { sessionId })`
4. **Prompt turn** — `transport.request('acp/promptTurn', { messages: [{ role: 'user', content: taskDescription }] })`
5. **Parse responses** — streaming JSON-RPC notifications with thought/action/result content → insert `acp_events` + broadcast
6. **Shutdown** — `transport.request('shutdown')` → `transport.notify('exit')` → SIGTERM fallback after 5s

### Agent Config

| Agent | Command | Env |
|---|---|---|
| `opencode` | `opencode acp` | `OPENCODE_API_KEY` |
| `claude-code` | `claude-agent-acp --agent claude-code` | (uses `claude /login` session) |
| `gemini` | `gemini --experimental-acp` | `GOOGLE_API_KEY` |

Test against OpenCode first (simplest auth), then claude-agent-acp.

### Files

| File | Purpose |
|---|---|
| `backend/src/lib/jsonrpc.ts` | Generic JSON-RPC 2.0 transport |
| `backend/src/lib/acp.ts` | Rewrite: use transport for handshake + prompt turns |
| `shared/types/index.ts` | Add JSON-RPC types if needed |

---

## Stream C: Git Worktree Manager (Task 3.1)

### Approach: Bare Repo Cache + Worktrees

- **Bare repo cache** at `.agemon/repos/{org}/{repo}.git` — cloned once, shared across tasks. Fetched on each worktree creation to get latest refs.
- **Worktrees** at `.agemon/tasks/{taskId}/{repoName}/` — one per repo per task. Branch: `agemon/{taskId}-{repoName}`.
- `simple-git` library for all git operations.

### GitWorktreeManager API

```typescript
class GitWorktreeManager {
  createWorktree(taskId: string, repoUrl: string, baseBranch?: string): Promise<string>
  deleteWorktree(taskId: string, repoName: string): Promise<void>
  getWorktreePath(taskId: string, repoName: string): string
  getDiff(taskId: string, repoName: string): Promise<string>
  listWorktrees(taskId: string): Promise<string[]>
}
```

### Flow

1. `POST /tasks/:id/start` → for each task repo:
   a. Clone bare repo if not cached (or fetch to update)
   b. Create worktree from bare repo at `.agemon/tasks/{taskId}/{repoName}/`
   c. Create branch `agemon/{taskId}-{repoName}` from `baseBranch` (default: `main`)
2. Pass worktree paths to agent as `cwd` (or in prompt context)
3. On task delete → clean up worktrees

### Files

| File | Purpose |
|---|---|
| `backend/src/lib/git.ts` | GitWorktreeManager class |
| `backend/src/routes/tasks.ts` | Wire worktree creation into start endpoint |
| `backend/package.json` | Add `simple-git` dependency |

---

## Integration Points (After All Streams Complete)

1. **Start flow** — `POST /tasks/:id/start` creates worktrees (Stream C) → spawns agent with worktree cwd and JSON-RPC handshake (Stream B) → frontend auto-updates via WS (Stream A)
2. **Thought streaming** — agent sends thoughts via JSON-RPC → backend broadcasts → Zustand store updates → TaskDetailView renders live
3. **Input handling** — agent sends `await_input` → Zustand shows prompt → user submits → `send_input` WS event → backend writes to agent stdin via JSON-RPC

---

## Non-Goals

- Terminal/PTY integration (Phase 5)
- Diff viewer UI (Phase 6)
- GitHub PR creation (Task 3.2)
- Auto-resume on startup (Task 4.2 — depends on this wave completing)

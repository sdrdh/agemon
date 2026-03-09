# Architecture Overview

## High-Level Architecture

```
Phone / Browser
      │
      │ HTTPS / WebSocket
      ▼
┌─────────────────────────────┐
│   Hono HTTP Server          │
│   Port 3000                 │
│                             │
│  REST API   WebSocket /ws   │
│  /api/*     (broadcast)     │
└──────┬──────────────────────┘
       │
   bun:sqlite
       │
┌──────▼───────────────────────┐
│   SQLite Database            │
│   tasks / agent_sessions /   │
│   acp_events /               │
│   awaiting_input / diffs     │
└──────────────────────────────┘
       │
  Agent Processes
  (ACP protocol)
       │
  Git Worktrees
  ~/.agemon/tasks/{id}/{repo}/
```

## Components

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `src/server.ts` | Hono app, WebSocket via `upgradeWebSocket`, auth middleware, route registration |
| `src/db/schema.sql` | SQLite DDL — all 5 tables |
| `src/db/client.ts` | Typed query helpers using `bun:sqlite` |
| `src/db/seed.ts` | Sample data for development |
| `src/routes/tasks.ts` | CRUD endpoints for tasks and sessions |
| `src/lib/git.ts` | Git worktree management (Task 3.1) |
| `src/lib/acp.ts` | ACP agent manager (Task 4.1) |
| `src/lib/pty.ts` | PTY session manager (Task 5.1) |

### Frontend (`frontend/`)

| File | Purpose |
|------|---------|
| `src/App.tsx` | TanStack Router setup + nav bar |
| `src/routes/` | Page components (task list, task detail, kanban, sessions) |
| `src/components/ui/` | shadcn/ui components (44px touch targets) |
| `src/components/custom/` | WsProvider, StatusBadge, custom app components |
| `src/lib/api.ts` | REST API client |
| `src/lib/ws.ts` | WebSocket client with auto-reconnect |
| `src/lib/store.ts` | Zustand store — chat messages, pending inputs, agent activity, unread sessions (all keyed by sessionId) |
| `src/lib/query.ts` | TanStack Query keys and query options for tasks, sessions, chat |

### Shared Types (`shared/types/index.ts`)

Single source of truth for:
- `Task`, `AgentSession`, `ACPEvent`, `AwaitingInput`, `Diff`
- `AgentSessionState`, `AgentType`
- `ServerEvent` / `ClientEvent` (WebSocket)
- `CreateTaskBody`, `UpdateTaskBody` (REST)

## Data Flow

### Task Lifecycle

```
User creates task (POST /api/tasks)
  → status: todo
  → broadcast task_updated

User starts agent (POST /api/tasks/:id/start)
  → status: working
  → spawn ACP agent process
  → broadcast task_updated

Agent emits thought events
  → INSERT into acp_events
  → broadcast agent_thought

Agent requests input (await_input event)
  → status: awaiting_input
  → INSERT into awaiting_input
  → broadcast awaiting_input

User answers (POST /api/tasks/:id/input/:inputId)
  → status: working
  → send response to agent
  → broadcast task_updated

Agent completes
  → status: done
  → generate diff
  → broadcast task_updated
```

### WebSocket Events

```typescript
// Server → All clients
{ type: 'task_updated', task: Task }
{ type: 'agent_thought', taskId, sessionId, content, eventType, messageId? }
{ type: 'awaiting_input', taskId, sessionId, question, inputId }
{ type: 'terminal_output', sessionId, data }
{ type: 'session_started', taskId, session: AgentSession }
{ type: 'session_ready', taskId, session: AgentSession }
{ type: 'session_state_changed', sessionId, taskId, state: AgentSessionState }

// Client → Server
{ type: 'send_input', taskId, inputId, response }
{ type: 'terminal_input', sessionId, data }
{ type: 'send_message', sessionId, content }
```

All events carry `sessionId` so the frontend can route messages to per-session chat stores and track unread activity per session.

## Database Schema

```sql
tasks           (id, title, description, status, repos, agent, created_at)
agent_sessions  (id, task_id, agent_type, external_session_id, pid, state, started_at, ended_at, exit_code)
acp_events      (id, task_id, session_id, type, content, created_at)
awaiting_input  (id, task_id, session_id, question, status, response, created_at)
diffs           (id, task_id, content, status, created_at)
```

## Agent Session Lifecycle

### State Machine

```
         ┌──────────┐
         │ starting │  (session record created, process spawning)
         └────┬─────┘
              │ ACP handshake complete
         ┌────▼─────┐
         │  ready   │  (waiting for user's first prompt)
         └────┬─────┘
              │ first prompt sent
         ┌────▼─────┐
         │  running │  (external_session_id captured from CLI output)
         └────┬─────┘
              │
     ┌────────┼────────────┐
     │        │            │
┌────▼───┐ ┌──▼────┐ ┌─────▼────────┐
│ stopped│ │crashed│ │ interrupted  │
│ (exit 0│ │(exit≠0│ │(server down) │
│  clean)│ │ crash)│ │              │
└────────┘ └───────┘ └──────────────┘
```

- **`ready`** — ACP handshake done, process is running, waiting for user's first prompt. No auto-start.
- **`interrupted`** — server process went down while the session was active. Distinct from `crashed` (the agent process itself died).
- **`stopped`** — clean exit (exit code 0).
- **`crashed`** — agent process exited with non-zero code.
- Task status is **derived** from session states, never auto-set to `done`. User must explicitly mark done.

### Relationship to Tasks and Events

```
Task
 └── 1..N AgentSessions
        └── N AcpEvents        (session_id FK + task_id for fast task queries)
        └── N AwaitingInputs   (session_id FK + task_id for fast task queries)
```

Both `acp_events` and `awaiting_input` carry `task_id` directly so task-level queries (e.g. Kanban view fetching all events for a task) don't need a join through `agent_sessions`.

### Capturing `external_session_id`

When an agent CLI starts, it emits its own session/run identifier in early stdout output (e.g. Claude Code's `--resume` ID). The agent manager captures this and writes it to `agent_sessions.external_session_id`.

### Auto-Resume on Server Startup

On boot, the server queries for sessions in `running` or `starting` state:
1. All such sessions are marked `interrupted`.
2. Each is re-spawned using `--resume <external_session_id>` (if available).
3. A new `agent_sessions` row is created for the re-spawned process, linked to the same task.

## ACP Agent Integration

Agents communicate via the **Agent Client Protocol (ACP)** — JSON-RPC 2.0 over stdin/stdout.

See [`docs/acp-agents.md`](./acp-agents.md) for:
- Supported agents (claude-agent-acp, OpenCode, Gemini CLI)
- Authentication requirements per agent
- JSON-RPC message format and lifecycle
- What needs to change in `acp.ts` for full protocol support

**Current status:** `acp.ts` handles the full ACP lifecycle — JSON-RPC handshake (`initialize` → `session/new`), prompt turns (`session/prompt`), session resume (`session/load`), crash recovery, and graceful shutdown. The lifecycle is split into `spawnAndHandshake` (→ ready state) and `sendPromptTurn` (ready → running) to support the session-centric UX where users see a `ready` session before sending their first message.

## Frontend State Management

### Session-Centric Chat

The task detail view uses per-session tabs. Each session has its own chat history, activity indicator, and pending inputs in the Zustand store, all keyed by `sessionId`.

### Unread Activity Indicators

When a user is viewing one session tab, background sessions may still receive events via WebSocket. The store tracks `unreadSessions: Record<string, boolean>`:

- **`markUnread(sessionId)`** — called by `WsProvider` on `agent_thought` and `awaiting_input` events
- **`clearUnread(sessionId)`** — called when the user switches to a tab or while viewing the active tab

The `SessionTabs` component renders two priority levels of indicators on inactive tabs:
- **Amber pulsing dot** — session has a pending input (agent is blocked, needs attention). Derived from the existing `pendingInputs` store state, no duplicate tracking.
- **Primary pulsing dot** — session has general unread activity (thoughts, tool calls).

The WebSocket connection is fully persistent — navigating away from a session never sends stop signals or disconnects.

## Security

- Static token auth: `Authorization: Bearer <AGEMON_KEY>`
- All API routes require auth (except `/api/health` and `/ws`)
- GitHub PAT loaded from env, never stored in DB
- `AGEMON_KEY` and `GITHUB_PAT` are filtered from agent subprocess environments
- Agents run in isolated git worktrees

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
│   tasks / acp_events /       │
│   awaiting_input / diffs /   │
│   terminal_sessions          │
└──────────────────────────────┘
       │
  Agent Processes
  (ACP protocol)
       │
  Git Worktrees
  .agemon/tasks/{id}/{repo}/
```

## Components

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `src/server.ts` | Hono app, WebSocket via `upgradeWebSocket`, auth middleware, route registration |
| `src/db/schema.sql` | SQLite DDL — all 5 tables |
| `src/db/client.ts` | Typed query helpers using `bun:sqlite` |
| `src/db/seed.ts` | Sample data for development |
| `src/routes/tasks.ts` | CRUD endpoints for tasks |
| `src/lib/git.ts` | Git worktree management (Task 3.1) |
| `src/lib/acp.ts` | ACP agent manager (Task 4.1) |
| `src/lib/pty.ts` | PTY session manager (Task 5.1) |

### Frontend (`frontend/`)

| File | Purpose |
|------|---------|
| `src/App.tsx` | TanStack Router setup |
| `src/routes/` | Page components (Kanban, Task detail) |
| `src/components/ui/` | shadcn/ui components (44px touch targets) |
| `src/components/custom/` | Kanban board, TaskCard, DiffViewer |
| `src/lib/api.ts` | REST API client |
| `src/lib/ws.ts` | WebSocket client with auto-reconnect |

### Shared Types (`shared/types/index.ts`)

Single source of truth for:
- `Task`, `ACPEvent`, `AwaitingInput`, `Diff`, `TerminalSession`
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
{ type: 'agent_thought', taskId, content }
{ type: 'awaiting_input', taskId, question, inputId }
{ type: 'terminal_output', sessionId, data }

// Client → Server
{ type: 'send_input', taskId, inputId, response }
{ type: 'terminal_input', sessionId, data }
```

## Database Schema

```sql
tasks              (id, title, description, status, repos, agent, created_at)
acp_events         (id, task_id, type, content, created_at)
awaiting_input     (id, task_id, question, status, response, created_at)
diffs              (id, task_id, content, status, created_at)
terminal_sessions  (id, task_id, shell, pid, created_at)
```

## Security

- Static token auth: `Authorization: Bearer <AGEMON_KEY>`
- All API routes require auth (except `/api/health` and `/ws`)
- GitHub PAT loaded from env, never stored in DB
- Agents run in isolated git worktrees

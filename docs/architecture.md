# Architecture Overview

## High-Level Architecture

```
Phone / Browser
      │
      │ HTTPS / WebSocket
      ▼
┌─────────────────────────────────────────┐
│   Hono HTTP Server (port 3000)          │
│                                         │
│  REST API /api/*   WebSocket /ws        │
│  Extension routes /api/extensions/:id/*  │
│  Extension pages  /p/:extensionId/*     │
│  Renderer endpoints /api/renderers/*    │
└──────┬──────────────────────────────────┘
       │
   Plugin System
   (loader · registry · builder · mount)
       │
   In-Memory Stores           File System
   (session-store.ts)    ~/.agemon/sessions/{id}/
    (task-store.ts)       ~/.agemon/extensions/tasks/data/tasks/
       │                 ~/.agemon/settings.json
   ACP Agent Processes
   (JSON-RPC 2.0 stdio)
       │
   Git Worktrees
   ~/.agemon/tasks/{id}/{repo}/
```

## Storage Model

All data lives in files under `~/.agemon/`. In-memory SQLite projections (via `bun:sqlite`) are rebuilt from files at startup — they are not persisted to disk.

| Data type | On-disk location | In-memory |
|-----------|-----------------|-----------|
| Sessions | `~/.agemon/sessions/{id}/session.json` (active) or `session_archived.json` (archived) | `session-store.ts` — in-memory SQLite, rebuilt from files at startup |
| ACP events | `~/.agemon/sessions/{id}/events.jsonl` | Read directly from JSONL on demand |
| Pending approvals | `~/.agemon/sessions/{id}/approvals.json` | `approval-store.ts` — in-memory Map, flushed to disk |
| Pending inputs | `~/.agemon/sessions/{id}/inputs.json` | `input-store.ts` — in-memory Map, flushed to disk |
| Tasks | `~/.agemon/tasks/{id}.json` (active) or `{id}_archived.json` | `task-store.ts` — in-memory SQLite, rebuilt from files at startup |
| Settings | `~/.agemon/settings.json` | `settings-store.ts` — in-memory Map, flushed to disk |
| MCP servers | `~/.agemon/mcp-servers.json` | `mcp-server-store.ts` — in-memory Map, flushed to disk |
| Approval rules | `~/.agemon/approval-rules.json` | `approval-rules-store.ts` — in-memory Map, flushed to disk |
| Extension settings | `~/.agemon/extensions/{id}/data/settings.json` | Read on demand |
| Extension KV store | `~/.agemon/extensions/{id}/data/store.json` | Read on demand |

**Write path (session-store / task-store):**
1. Update in-memory SQLite projection
2. Atomically flush JSON to disk (`lib/fs.ts atomicWriteJsonSync`)

**On startup:** Both stores scan their directories and load all JSON files into the in-memory projection. No migration steps needed.

---

## Backend Components

### Core (`backend/src/`)

| File | Purpose |
|------|---------|
| `server.ts` | Startup, directory init, extension wiring, symlink setup |
| `app.ts` | Hono app, auth middleware, WebSocket server, broadcast |
| `routes/sessions.ts` | Session CRUD — create, list, stop, archive, resume |
| `routes/dashboard.ts` | Dashboard aggregation — active/idle sessions, summary counts |
| `routes/renderers.ts` | Serve compiled extension renderer/page/icon JS to frontend |
| `routes/approvals.ts` | Approval listing — proxies to approval-store |
| `routes/system.ts` | Health check, version, server status, update/restart/rebuild |
| `db/client.ts` | DB facade — thin wrapper over file-based stores, preserves old call-site API |
| `db/helpers.ts` | Row mappers and column constants |

### Agent Communication (`backend/src/lib/acp/`)

| File | Purpose |
|------|---------|
| `index.ts` | Public API — `spawnAndHandshake`, `sendPromptTurn`, `stopAgent`, `resumeSession` |
| `lifecycle.ts` | Process spawning, EventBridge emit on state changes, crash recovery |
| `handshake.ts` | JSON-RPC `initialize` → `session/new` handshake |
| `prompt.ts` | `session/prompt` turns, tool call parsing, event streaming |
| `resume.ts` | `session/load` resume for interrupted sessions |
| `event-log.ts` | Per-session JSONL event log + session dir management |
| `session-dirs.ts` | Shared map: `sessionId → directory path` |

### In-Memory Stores (`backend/src/lib/`)

| File | Purpose |
|------|---------|
| `session-store.ts` | In-memory SQLite projection of sessions + flush to `session.json` |
| `task-store.ts` | In-memory SQLite projection of tasks + flush to `{id}.json` |
| `approval-store.ts` | In-memory Map of pending approvals + flush to `approvals.json` |
| `input-store.ts` | In-memory Map of pending inputs + flush to `inputs.json` |
| `mcp-server-store.ts` | In-memory Map of MCP server configs + flush to `mcp-servers.json` |
| `approval-rules-store.ts` | In-memory Map of auto-approval rules + flush to `approval-rules.json` |
| `settings-store.ts` | In-memory Map of global settings + flush to `settings.json` |
| `fs.ts` | Atomic file write utilities for JSON persistence |

### Extension System (`backend/src/lib/plugins/`)

See [extensions.md](./extensions.md) for full reference.

| File | Purpose |
|------|---------|
| `loader.ts` | Plugin discovery, dependency install, `onLoad()` invocation, skill wiring |
| `registry.ts` | Global extension registry — lookup by ID, message type, or page path |
| `mount.ts` | Mount extension API routes onto Hono; serve extension list/settings endpoints |
| `builder.ts` | Build extension renderers at startup; in-memory cache; file watch + hot reload |
| `event-bridge.ts` | Hook/listener event bus for cross-extension and core→extension events |
| `agent-registry.ts` | Registry for agent providers (built-in + extension-contributed) |
| `workspace.ts` | `WorkspaceProvider` interface |
| `workspace-registry.ts` | Registry for workspace providers |
| `workspace-default.ts` | Default workspace provider — task dir + git worktrees |

---

## Frontend Components

### Routes (`frontend/src/routes/`)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `index.tsx` | Dashboard — active/idle sessions, needs-input queue, recently completed |
| `/sessions` | `sessions.tsx` | Session list with archive/resume/stop actions |
| `/sessions/:id` | `sessions.$id.tsx` | Standalone session chat view |
| `/p/:extensionId/*` | `plugin.tsx` | Generic extension page host — fetches + mounts compiled extension JS |
| `/settings` | `settings.tsx` | App settings, extension list, extension configuration |
| `/projects` | `projects.tsx` | Project/repo grouping view |
| `/tasks/:id` | `tasks.$id.tsx` | Redirect → `/p/tasks/:id` |
| `/login` | `login.tsx` | Auth gate |

### Key Components (`frontend/src/components/custom/`)

| File | Purpose |
|------|---------|
| `chat-panel.tsx` | Full chat panel (message history + input) for a session |
| `session-list.tsx` | Reusable session list — used in extension pages and dashboard |
| `session-list-panel.tsx` | Sidebar session list panel with selection state |
| `session-chat-panel.tsx` | Composed session list + chat panel for task detail views |
| `dashboard/*.tsx` | Dashboard section components (active, idle, needs-input, completed) |

### State (`frontend/src/lib/`)

| File | Purpose |
|------|---------|
| `store.ts` | Zustand store — chat messages, pending inputs/approvals, unread indicators, WS connected state |
| `query.ts` | TanStack Query keys and query factories for sessions, tasks, chat history |
| `ws.ts` | WebSocket client — auto-reconnect, event routing to store |
| `api.ts` | REST API client (authenticated fetch wrapper) |
| `plugin-kit-context.ts` | React context exposing host components (`SessionList`, `ChatPanel`, `StatusBadge`) to extension pages |

### Shared Types (`shared/types/`)

| File | Purpose |
|------|---------|
| `index.ts` | `Task`, `AgentSession`, `ACPEvent`, `AwaitingInput`, `ServerEvent`, `ClientEvent` + all enums |
| `plugin.ts` | `ExtensionManifest`, `ExtensionNavItem`, `InputExtensionManifest`, `CustomRendererManifest` |
| `plugin-kit.ts` | `PluginKit` — interface for host components exposed to extension renderers |

---

## WebSocket Events

### Server → All Clients

```typescript
{ type: 'task_updated';           task: Task }
{ type: 'agent_thought';          taskId, sessionId, content, eventType: 'thought'|'action', messageId? }
{ type: 'awaiting_input';         taskId, sessionId, question, inputId }
{ type: 'terminal_output';        sessionId, data }
{ type: 'session_started';        taskId, session: AgentSession }
{ type: 'session_ready';          taskId, session: AgentSession }
{ type: 'session_state_changed';  sessionId, taskId, state: AgentSessionState }
{ type: 'approval_requested';     approval: PendingApproval }
{ type: 'approval_resolved';      approvalId, decision: ApprovalDecision }
{ type: 'config_options_updated'; sessionId, taskId, configOptions: SessionConfigOption[] }
{ type: 'available_commands';     sessionId, taskId, commands: AgentCommand[] }
{ type: 'turn_cancelled';         sessionId, taskId }
{ type: 'turn_completed';         sessionId, taskId }
{ type: 'session_usage_update';   sessionId, taskId, usage: SessionUsage }
{ type: 'extensions_changed';     extensionIds: string[] }
{ type: 'update_available';       version, should_notify }
{ type: 'server_restarting' }
{ type: 'full_sync_required' }
```

### Client → Server

```typescript
{ type: 'send_input';      sessionId, inputId, response }
{ type: 'terminal_input';  sessionId, data }
{ type: 'send_message';    sessionId, content }
{ type: 'approval_response'; approvalId, decision }
{ type: 'set_config_option'; sessionId, configId, value }
{ type: 'cancel_turn';     sessionId }
{ type: 'resume';          lastSeq }
```

All server events carry `sessionId` so the frontend can route to per-session chat state.

---

## Agent Session Lifecycle

```
         ┌──────────┐
         │ starting │  (record created, process spawning)
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
│(exit 0)│ │(exit≠0│ │(server down) │
└────────┘ └───────┘ └──────────────┘
```

- **`ready`** — ACP handshake done, process running, waiting for first prompt.
- **`running`** — active turn in flight; `external_session_id` has been captured.
- **`interrupted`** — server went down while session was active. Distinct from `crashed` (agent process died on its own).
- **`stopped`** — clean exit (code 0). Can be resumed.
- **`crashed`** — non-zero exit. May be resumable if `external_session_id` was captured.

Task status is **derived** from session states. It never auto-transitions to `done` — the user must mark explicitly.

### Auto-Resume on Server Startup

On boot, sessions in `running` or `starting` state are marked `interrupted` and re-spawned using `session/load <external_session_id>` if available.

### Relationship

```
Session
 └── events.jsonl    (append-only ACP event stream)
 └── approvals.json  (pending/resolved approvals for this session)
 └── inputs.json     (pending/answered input requests)
 └── session.json    (session state snapshot)
```

Tasks have no direct FK to sessions — the link is `session.meta.taskId`. The task-store and session-store both keep in-memory projections for fast cross-querying.

---

## Extension System

The extension system is the primary extensibility mechanism. Almost all product features (tasks, MCP config, skills manager, voice input) are implemented as extensions.

**Core = session engine + event bridge + extension host.** Everything else is an extension.

See [extensions.md](./extensions.md) for: extension structure, manifest reference, `ExtensionContext` API, extension points, frontend globals, and roadmap items.

---

## Security

- **Auth:** Delegated to the reverse proxy (Tailscale, Cloudflare Access, etc.). Server binds to `127.0.0.1` and has no built-in auth.
- **GitHub:** Git operations use the machine's GitHub CLI auth (`gh auth login`) or SSH keys. No PAT env var is required.
- **Extension trust:** All extensions run in the main process with full access to the filesystem and API. Installing an extension grants it full trust. See [extensions.md § Trust Model](./extensions.md#trust-model).

# Plugin System v2 — Architectural Design

**Date:** 2026-03-20
**Status:** Design / Pre-implementation
**Builds on:** Plugin System POC (merged #27)

---

## Overview

The current plugin system (v1) adds extensibility on top of the existing monolithic core. This design takes the next step: make the core minimal enough that almost everything — including tasks, git, agent configs, and all frontend routes — lives in plugins.

**Goal:** Core = session engine + event bridge + plugin host. Nothing else.

---

## What Stays in Core

### Backend

| Module | Purpose |
|--------|---------|
| `lib/acp.ts` | ACP session lifecycle — spawn, stdio bridge, state machine |
| `lib/jsonrpc.ts` | JSON-RPC 2.0 protocol framing |
| `lib/plugins/` | Plugin loader, registry, mount, types |
| `app.ts` | Auth middleware, WebSocket server, event ring |
| `server.ts` | Startup, directory init, plugin wiring |
| `routes/sessions.ts` | Bare session CRUD |
| `db/client.ts` | SQLite connection |
| `db/sessions.ts` | `sessions` table — state machine only |
| `db/migrations.ts` | Stripped to 4-table core schema |

**Core DB tables (4):** `sessions`, `acp_events`*, `awaiting_input`*, `settings`

*See JSONL Events section — `acp_events` moves to files.

### Frontend

| File | Purpose |
|------|---------|
| `App.tsx` (shell only) | Auth gate + plugin route host |
| `routes/sessions/:id` | Session chat view — streams ACP events |
| `/p/:pluginId/*` | Plugin page host |
| `components/custom/chat-*` | Chat bubbles, messages area, input area |
| `components/custom/activity-group` | Tool call groups |
| `ws-provider.tsx` | WebSocket connection + event store |
| `lib/store.ts` (core slice) | Session state only |

**Core frontend routes (3):** `/login`, `/sessions/:id`, `/p/:pluginId/*`

---

## What Leaves Core → Plugins

| Module | Lines | Destination |
|--------|-------|-------------|
| `routes/skills.ts` | 358 | skills-manager plugin |
| `routes/mcp-config.ts` | 346 | mcp-config plugin |
| `lib/agents.ts` | 328 → ~50 | AgentProvider plugins |
| `lib/context.ts` | 458 → ~50 | tasks + workspace plugins |
| `lib/acp/prompt.ts` | 168 | tasks + workspace plugins |
| `lib/git.ts` | 201 | git-workspace plugin |
| `routes/tasks.ts` | 175 | tasks plugin |
| `db/tasks.ts` | 126 | tasks plugin |
| `lib/version.ts` + `updater.ts` | 428 | system plugin |
| `routes/system.ts` | 123 → ~30 | system plugin |
| `db/migrations.ts` | 313 → ~80 | 4-table core schema |
| `routes/settings.tsx` (FE) | 632 | system plugin page |
| `routes/index.tsx` (FE) | 270 | tasks plugin page |
| `routes/kanban.tsx` (FE) | 189 | tasks plugin page |
| `routes/tasks.$id.tsx` (FE) | 211 | tasks plugin page |
| `components/custom/skills-manager` (FE) | 380 | skills plugin page |
| `components/custom/mcp-server-form` (FE) | 241 | mcp plugin page |
| `components/custom/dashboard/*` (FE) | ~420 | tasks plugin pages |

**Estimated result:** ~7,200 lines core vs ~18,400 today — **~60% reduction**.

The more important metric: core has zero imports from any domain module after extraction. `acp/spawn.ts` takes a `WorkspaceProvider` and an `AgentProvider` — both interfaces. It has no knowledge of git, tasks, or agent-specific configuration.

---

## Six Plugin Contracts

A plugin can implement any combination of these:

```
┌─────────────────────┬──────────────────────────────────────────────────────┐
│ Type                │ What it provides                                      │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ WorkspaceProvider   │ prepare() · cleanup() · getDiff()                    │
│                     │ contextSections() · guidelinesSections()             │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ AgentProvider       │ command · env · parseOutput · pluginPaths            │
│                     │ skillPaths · autoLoadsContextFile                    │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ Feature Plugin      │ apiRoutes · pages · queries                          │
│                     │ hooks · listeners · own SQLite db                    │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ Renderer            │ messageType → React component                        │
│                     │ receives { message, actions: ChatActions }           │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ InputExtension      │ toolbar button in chat input area                    │
│                     │ receives { sessionId, onSetInputText, actions }      │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ Cross-cutting       │ event bridge hooks/listeners only                    │
│                     │ no UI, no routes — pure side effects                 │
└─────────────────────┴──────────────────────────────────────────────────────┘
```

### Updated `PluginExports` Type

```ts
interface PluginExports {
  // Existing (v1)
  apiRoutes?: (app: Hono) => void;
  pageRoutes?: RouteConfig[];
  renderers?: CustomRenderer[];       // widened: component gets { message, actions }
  pages?: PluginPage[];

  // New (v2)
  workspaceProvider?: WorkspaceProvider;
  agentProviders?: AgentProvider[];
  inputExtensions?: InputExtension[];
  queries?: Record<string, (...args: unknown[]) => unknown>;
  hooks?: Record<string, (payload: unknown) => Promise<void>>;   // blocking
  listeners?: Record<string, (payload: unknown) => void>;        // fire-and-forget
}
```

---

## Event Bridge

Plugins communicate through a typed event bridge rather than direct imports.

```ts
interface PluginContext {
  // Existing
  agemonDir: string;
  pluginDir: string;
  db: Database;          // plugin's own SQLite at ~/.agemon/plugins/{id}/state.db
  coreDb: Database;      // read-only access to sessions/acp_events/awaiting_input
  getSetting: (key: string) => string | null;
  logger: Logger;

  // New (v2)
  hook(event: string, handler: (payload: unknown) => Promise<void>): void;
  on(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
  broadcast(wsEvent: object): void;
}
```

**`ctx.hook()`** — async, blocking. Core awaits all hooks before proceeding. Use for: mutating state before an event completes (e.g. tasks plugin hooks `session:before_spawn` to prepare workspace).

**`ctx.on()`** — fire-and-forget. Core does not await. Use for: side effects that don't need to block (e.g. notifications plugin listens to `session:awaiting_input`).

**`ctx.emit()`** — plugin-to-plugin. Does not go to WebSocket clients.

**`ctx.broadcast()`** — sends to all connected WebSocket clients.

### Core Event Catalogue

| Event | Payload | Type |
|-------|---------|------|
| `session:before_spawn` | `{ sessionId, agentType, meta }` | hookable |
| `session:state_changed` | `{ sessionId, from, to }` | both |
| `session:awaiting_input` | `{ sessionId, questionId, question }` | both |
| `session:input_received` | `{ sessionId, questionId, response }` | both |
| `session:ended` | `{ sessionId, exitCode, state }` | both |
| `approval:requested` | `{ sessionId, approvalId, tool, input }` | both |
| `approval:resolved` | `{ sessionId, approvalId, decision }` | both |
| `workspace:prepared` | `{ sessionId, path }` | listener only |
| `workspace:diff_ready` | `{ sessionId, diff }` | listener only |

---

## Plugin-Owned SQLite

Each plugin gets its own isolated SQLite database:

```
~/.agemon/plugins/{pluginId}/state.db    ← ctx.db (read-write)
~/.agemon/agemon.db                      ← ctx.coreDb (read-only)
```

Plugins run their own migrations. Core has no knowledge of plugin schemas. Uninstalling a plugin removes its `state.db` cleanly.

---

## JSONL Events (Replacing `acp_events` Table)

ACP events are append-only by nature. SQLite is the wrong tool — it adds B-tree overhead, index maintenance, and a binary file you can't grep.

### New Layout

```
~/.agemon/sessions/{timestamp}_{sessionId}/
  events.jsonl    ← append-only ACP event stream
  meta.json       ← session metadata snapshot (agent_type, started_at, etc.)
```

The timestamp prefix enables chronological directory listing without `stat()` calls — useful for memory-cms and recovery scenarios where the DB is unavailable.

### Event Format

```jsonl
{"id":"...","type":"thought","content":"...","ts":"2026-03-20T09:00:00Z"}
{"id":"...","type":"action","content":"{\"tool\":\"Read\",...}","ts":"..."}
{"id":"...","type":"await_input","question":"Proceed?","ts":"..."}
{"id":"...","type":"input_response","ref_id":"...","response":"yes","ts":"..."}
{"id":"...","type":"result","content":"Done.","ts":"..."}
```

`awaiting_input` becomes two event types (`await_input` + `input_response`). Pending input = last `await_input` with no matching `input_response`. State is derived from the log and held in memory; rebuilt on startup via JSONL replay.

### WebSocket Replay on Client Connect

```
Client                           Server
──────                           ──────
GET /sessions/:id/events    →    read events.jsonl → return array
                            ←    [{...}, ...]  +  X-Offset: 48291
render all events
connect WebSocket           →
subscribe { sessionId,           read from byte 48291 to EOF (gap fill)
  fromOffset: 48291 }      ←
                                 switch to live append notifications
```

The `X-Offset` header is the file byte size at REST response time. WS subscription starts from that exact offset — no deduplication needed, no ring buffer needed.

### Performance vs SQLite

| Operation | SQLite | JSONL |
|-----------|--------|-------|
| Write one event | ~0.5ms (WAL + 2 indexes) | ~0.05ms (append) |
| Read full session | fast (indexed scan) | fast (sequential read) |
| Cross-session query | fast (SQL join) | slow → moves to in-memory projection |
| Startup recovery | SQL query | file replay |

Write-heavy during active sessions, read-once for replay — JSONL fits the actual access pattern better.

---

## Sessions Are Core, Tasks Are Not

A common question: should sessions be part of the tasks plugin?

**No.** Sessions are the fundamental unit. `acp_events`, `awaiting_input`, and the WebSocket session chat view are all core. Tasks are an organizational layer built on top.

The coupling is broken by replacing `agent_sessions.task_id FK` with `meta_json TEXT`. When the tasks plugin creates a session it writes `{ "task_id": "..." }` into `meta_json`. The tasks plugin owns the task→session mapping in its own `task_sessions` table. Core has zero knowledge of what a task is.

This means sessions can exist without any plugin — raw ACP sessions, useful for testing, scripting, or other organizational models (sprints, projects) that other plugins might provide.

---

## Tasks Plugin — The Biggest Extraction

The tasks plugin is the reference implementation of a rich multi-capability plugin:

```
plugins/tasks/
├── agemon-plugin.json
├── index.ts            apiRoutes, pages, renderers, skills, queries, hooks
├── skills/
│   ├── create-task.md
│   ├── list-tasks.md
│   └── mark-done.md
└── ui/
    ├── Dashboard.tsx       page: /p/tasks/
    ├── Kanban.tsx          page: /p/tasks/kanban
    ├── TaskDetail.tsx      page: /p/tasks/:id
    ├── NewTask.tsx         page: /p/tasks/new
    ├── TaskStatusBubble.tsx   renderer: "task_status"
    └── TaskCreatedBubble.tsx  renderer: "task_created"
```

Task status derivation (currently hardcoded in `acp/lifecycle.ts`) moves entirely into the tasks plugin via event bridge:

```ts
ctx.on('session:state_changed', ({ sessionId, to }) => {
  const taskId = getTaskForSession(sessionId);
  if (taskId) deriveAndUpdateTaskStatus(taskId);
});
```

---

## Frontend Plugin Pages

The core frontend routing collapses significantly:

| Current route | Migrates to | Plugin |
|---------------|-------------|--------|
| `/` (dashboard) | `/p/tasks/` | tasks |
| `/kanban` | `/p/tasks/kanban` | tasks |
| `/tasks/:id` | `/p/tasks/:id` | tasks |
| `/tasks/new` | `/p/tasks/new` | tasks |
| `/projects` | `/p/tasks/projects` | tasks |
| `/sessions` | `/p/tasks/sessions` | tasks |
| `/settings` | `/p/system/settings` | system |
| `/mcp-config` | `/p/mcp-config/` | mcp-config |
| `/memory` | `/p/memory-cms/` | memory-cms |

Navigation is fully plugin-driven — the nav bar reads `navLabel`/`navIcon` from loaded plugin manifests. No hardcoded links.

### Renderer `ChatActions` Interface

Custom renderers currently receive only `{ message }`. Widening to include `actions` enables interactive plugin renderers:

```ts
interface ChatActions {
  sendMessage: (text: string) => void;
  sendMessageWithAttachment: (text: string, file: File) => void;
  showToast: (message: string, variant?: 'default' | 'destructive') => void;
  navigate: (path: string) => void;
}
```

### `inputExtensions` — Chat Input Toolbar

New slot in `PluginExports` for adding buttons to the chat input toolbar:

```
[ 📎 ] [ 🎤 ] [ textarea                    ] [ send ]
  ↑      ↑
  file   voice
  plugin plugin
```

Each extension receives `InputExtensionProps`: `{ sessionId, disabled, inputText, onSetInputText, actions: ChatActions }`.

---

## Plugin Ecosystem

### Bundled (ship with agemon, on by default)

| Plugin | Type |
|--------|------|
| `git-workspace` | WorkspaceProvider |
| `claude-code` | AgentProvider |
| `tasks` | Feature (pages, renderers, skills, hooks) |
| `system` | Feature (version, update, settings UI) |
| `approval-renderer` | Renderer |
| `input-renderer` | Renderer |

### Optional (installable)

| Plugin | Type |
|--------|------|
| `jj-workspace` | WorkspaceProvider + page (change graph) |
| `local-dir` | WorkspaceProvider (no VCS) |
| `opencode` | AgentProvider |
| `gemini-cli` | AgentProvider |
| `pi` | AgentProvider |
| `codex` | AgentProvider |
| `mcp-config` | Feature |
| `skills-manager` | Feature |
| `memory-cms` | Feature |
| `diff-viewer` | Feature + Renderer |
| `file-attachment` | InputExtension |
| `voice-input` | InputExtension |
| `notifications` | Cross-cutting |
| `openclaw` | Cross-cutting |
| `plugin-builder` | Feature (Studio, EventBusViewer, TemplateGallery) |

---

## Jujutsu Workspace Plugin

A `WorkspaceProvider` implementation using jj instead of git worktrees. Addresses remote fetch friction — `git fetch origin --prune` runs on every session start in the current `GitWorktreeManager`.

**Backend:**
- `jj workspace add ~/.agemon/sessions/{id}/{repo}` instead of `git worktree add`
- `jj workspace forget` + rm for cleanup
- `jj diff` for diff (no staging area — jj tracks all working copy changes automatically)
- Checks for `jj` binary at plugin load, fails gracefully if absent
- Works in colocated mode (`jj git init --colocate`) — repo stays valid git for `gh pr create`

**Agent guidelines injected via `contextSections()`:**
```
Use jj commands, not git:
  jj new          (instead of git checkout -b)
  jj describe     (instead of git commit -m)
  jj diff / jj status
  jj git push     (to push to remote)
No staging area — jj tracks working copy changes automatically.
```

**Frontend page:** `jj log --graph --color never` output parsed and rendered as a styled change graph. Change IDs are clickable. Shows current working change and bookmark.

---

## Plugin Builder

A meta-plugin for building plugins from within Agemon:

```
plugins/plugin-builder/
├── agemon-plugin.json    navLabel: "Studio"  navIcon: "wrench"
└── ui/
    ├── Studio.tsx           Monaco editor + manifest form + hot reload button
    ├── EventBusViewer.tsx   real-time stream of all event bridge events
    ├── TemplateGallery.tsx  scaffold: feature / renderer / input-ext / workspace / agent
    └── PluginLogs.tsx       stdout from onLoad() + runtime errors per plugin
```

Studio flow: pick template → files scaffold into `~/.agemon/plugins/{name}/` → edit in Monaco → Reload → plugin hot-swaps → frontend reflects new routes/renderers/nav items immediately.

The EventBusViewer is the key development tool — watch `session:state_changed`, `approval:requested`, `workspace:prepared` flow in real time to know exactly which hook to attach to.

---

## Interesting Capabilities Unlocked

**Session forking** — because all session state lives in JSONL files, a plugin can snapshot the event log at any point and spawn a new session resuming from that snapshot with a different prompt. Branching exploration of agent approaches from the same starting point.

**Multi-agent orchestration as a plugin** — spawn N sessions, pipe output from one as input to another. A directed graph of agent sessions (research → implement → review) coordinated by ~200 lines of plugin code over the core session engine.

**Agents building plugins** — plugin-builder + capable agent + event bridge = an agent session that scaffolds a plugin, hot-loads it, and changes how future sessions work. The system extends itself.

**Remote workspace providers** — `WorkspaceProvider` is an interface. A plugin can SSH into a remote machine or use a Docker container as the workspace. Agent runs locally, code lives remotely.

**Event bridge as observability** — a single cross-cutting plugin taps the bridge and produces audit logs, Grafana metrics, Slack webhooks, or budget alerts. Zero changes to any other plugin.

**Declarative workflow plugins** — a plugin reads a YAML pipeline definition and coordinates multi-step agent sessions without code.

**Agemon as an embeddable runtime** — the ~7,000-line core can be embedded in VS Code extensions, CLI tools, or GitHub Actions. The plugin system means each embedding loads only the plugins it needs.

---

## Implementation Roadmap

### Step 1: Solidify Plugin Foundation
- Event bridge on `PluginContext` (`ctx.hook`, `ctx.on`, `ctx.emit`, `ctx.broadcast`)
- Plugin-owned SQLite (`ctx.db`)
- `queries` export in `PluginExports`

### Step 2: Interface Extractions (parallelisable)
- `WorkspaceProvider` interface — `GitWorktreeManager` becomes bundled default
- `AgentProvider` interface — `AGENT_CONFIGS` becomes registered providers

### Step 3: JSONL Events
- Replace `acp_events` table with per-session JSONL files
- Drop `task_id` from `agent_sessions`, replace with `meta_json`
- Keep `awaiting_input` as in-memory projection rebuilt from JSONL on startup

### Step 4: Extract Tasks Plugin
- Tasks, repos, task_repos, dashboard, kanban, task detail all move
- Tasks plugin wires into event bridge for status derivation

### Step 5: Frontend Plugin Pages
- Plugin page host at `/p/:pluginId/*`
- Plugin-driven nav bar
- Tasks plugin ships its own pages
- Widen renderer interface to include `ChatActions`
- Add `inputExtensions` slot

### Step 6: Extract Remaining Plugins
- mcp-config, skills-manager, system plugins

### Step 7: New Plugins
- jj-workspace, additional agent providers, plugin-builder, notifications, openclaw

Steps 1–3 are pure backend refactoring with no user-visible change. Steps 4–5 are where the system becomes genuinely flexible. Steps 6–7 are the payoff.

> **Migration note for Step 3:** Keep the `acp_events` table as a read-only fallback during transition. New sessions write to JSONL; old sessions are readable from SQLite. Remove the table after one release cycle.

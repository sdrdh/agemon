# Plugin System v2 — Overview & Goals

---

## Why v2?

v1 added extensibility *on top of* the existing monolithic core. The core still owns tasks, git, agent configs, skills management, and all frontend routes. v2 inverts this: the core becomes a minimal session engine, and everything domain-specific lives in plugins.

**The test:** after extraction, `acp/spawn.ts` must have zero imports from any domain module — no git, no tasks, no agent-specific config. It takes interfaces (WorkspaceProvider, AgentProvider) and knows nothing about what's behind them.

---

## What Stays in Core

### Backend (~7,200 lines, down from ~18,400)

| Module | Purpose |
|--------|---------|
| `lib/acp.ts` | ACP session lifecycle — spawn, stdio bridge, state machine |
| `lib/jsonrpc.ts` | JSON-RPC 2.0 framing (LF-only, see pi-mono pattern) |
| `lib/plugins/` | Loader, registry, mount, types |
| `app.ts` | Auth middleware, WebSocket server, event ring |
| `server.ts` | Startup, dir init, plugin wiring |
| `routes/sessions.ts` | Bare session CRUD + spawn |
| `lib/fs.ts` | `atomicWrite()` utility — filesystem-first writes |
| `lib/store.ts` | `buildInMemoryDb()` — rebuilds in-memory SQLite from `sessions/` on startup |

**No persistent SQLite in core.** State lives on the filesystem:
- `~/.agemon/sessions/{id}/session.json` — session state
- `~/.agemon/sessions/{id}/events.jsonl` — ACP events
- `~/.agemon/settings.json` — key-value settings

In-memory SQLite is rebuilt from these files on every startup. Queries run against in-memory. Writes go to filesystem first (atomic rename), then in-memory. See `10-filesystem-storage.md`.

**Note:** `tasks`, `repos`, `task_repos` are NOT in core at all. They live in the tasks plugin's own filesystem namespace (`~/.agemon/plugins/tasks/`). Core has zero schema knowledge of tasks.

### Frontend (3 routes)

| File | Purpose |
|------|---------|
| `App.tsx` (shell) | Auth gate + plugin route host |
| `routes/sessions/:id` | Session chat — streams ACP events |
| `/p/:pluginId/*` | Plugin page host (blob URL import) |
| `components/custom/chat-*` | Bubbles, messages area, input area |
| `ws-provider.tsx` | WebSocket + event store |
| `lib/store.ts` (core slice) | Session state only |

---

## What Leaves Core → Plugins

| Module | Lines | Destination |
|--------|-------|-------------|
| `lib/agents.ts` | 328 → ~50 | AgentProvider plugins |
| `lib/context.ts` | 458 → ~50 | tasks + workspace plugins |
| `lib/acp/prompt.ts` | 168 | tasks + workspace plugins |
| `lib/git.ts` | 201 | git-workspace plugin |
| `routes/tasks.ts` | 175 | tasks plugin |
| `db/tasks.ts` | 126 | tasks plugin |
| `routes/skills.ts` | 358 | skills-manager plugin |
| `routes/mcp-config.ts` | 346 | mcp-config plugin |
| `lib/version.ts` + `updater.ts` | 428 | system plugin |
| `routes/system.ts` | 123 → ~30 | system plugin |
| `routes/settings.tsx` (FE) | 632 | system plugin page |
| `routes/index.tsx` (FE) | 270 | tasks plugin page |
| `routes/kanban.tsx` (FE) | 189 | tasks plugin page |
| `routes/tasks.$id.tsx` (FE) | 211 | tasks plugin page |
| `components/custom/skills-manager` (FE) | 380 | skills plugin page |
| `components/custom/mcp-server-form` (FE) | 241 | mcp plugin page |
| `components/custom/dashboard/*` (FE) | ~420 | tasks plugin pages |

---

## pi-mono Patterns to Adopt

### Layered Contracts (pi-ai → pi-agent-core → coding-agent)

pi-mono has three layers with clean type contracts at each seam — no circular coupling. For Agemon:

```
core (session engine)
  ↓ WorkspaceProvider interface (optional)
  ↓ AgentProvider interface
  ↓ Event bridge
plugins (implement the interfaces, register via event bridge)
```

Each layer only knows the interface above it, never the concrete implementation below.

### Event Bus (from coding-agent)

pi-mono's `createEventBus()` is a simple `Map<string, Set<HandlerFn>>`. Agemon adds the blocking `hook()` vs fire-and-forget `on()` distinction (core awaits hooks, doesn't await listeners) and a `broadcast()` shortcut to WebSocket clients.

### `beforeToolCall` / `afterToolCall` hooks (from pi-agent-core)

pi-mono's `AgentLoopConfig` exposes `beforeToolCall` and `afterToolCall` callbacks that intercept tool execution. This maps directly to Agemon's approval mechanism: the core ACP bridge can expose equivalent hooks that plugins (like an approval-renderer plugin) subscribe to.

### Extension Registration Queue (from coding-agent)

pi-mono queues registrations during extension load (`pendingProviderRegistrations`), then flushes on `bindCore()`. Agemon's plugin loader can do the same: plugins register their exports during `onLoad()`, and the host flushes them once all plugins have loaded. This prevents ordering issues where plugin A tries to use plugin B's routes before B has registered them.

### SDK Factory Pattern (from coding-agent)

pi-mono's `createAgentSession()` follows a deterministic 7-step setup: managers → resources → extensions → tools → system prompt → agent. Agemon's `spawnSession()` should follow the same pattern: load WorkspaceProvider → prepare() → load AgentProvider → build args/env → build context CLAUDE.md → spawn process.

### Model Cycling (from coding-agent) — NOT applicable to Agemon

`scopedModels` + Ctrl+P works in pi-mono because the agent loop controls model selection internally. In Agemon, a session is a spawned OS process over stdio. You cannot hot-swap the process mid-session.

`AgentRegistry` is **spawn-time only**: resolves which binary to run when creating a session. To use a different agent, create a new session — possibly on the same task. This is multi-agent via concurrent sessions, not mid-session switching.

---

## Capabilities Unlocked

**Session forking** — JSONL snapshots let a plugin branch execution at any event offset. Try different prompts from the same starting state.

**Multi-agent orchestration** — a plugin spawns N sessions, wires output from one as input to another. Research → implement → review pipeline in ~200 lines.

**Agents building plugins** — plugin-builder + event bridge = an agent session that scaffolds and hot-loads a plugin, changing how future sessions work.

**Remote workspace** — WorkspaceProvider is an interface. A plugin can SSH into a remote machine or use Docker. Agent runs locally, code lives remotely.

**Event bridge as observability** — a single cross-cutting plugin taps the bridge: audit logs, Grafana metrics, Slack webhooks, budget alerts. Zero changes elsewhere.

**Agemon as embeddable runtime** — ~7,000-line core embeds in VS Code extensions, CLI tools, GitHub Actions. Each embedding loads only the plugins it needs.

# Plugin System Audit

> **Date:** 2025-03-22  
> **Branch:** `feat/plugin-system-v2`  
> **Commit:** `451a730`  
> **Plugins loaded:** tasks, mcp-config, skills-manager, memory-cms, mcp-server, voice-input

---

## 1. Architecture Overview

The plugin system follows a **manifest + entry point + renderer** pattern:

```
plugins/
  my-plugin/
    agemon-plugin.json    # Declarative manifest (metadata, nav, settings, skills)
    index.ts              # Backend entry: onLoad(ctx) → PluginExports
    renderers/            # TSX components compiled to browser ESM at startup
      page.tsx
      icon.tsx
    build.ts              # Bun.build script (externalize React → window.__AGEMON__)
    dist/renderers/       # Build output (cached in memory by builder.ts)
    skills/               # Agent-discoverable skills (symlinked into ~/.agemon/skills/)
    data/                 # Persistent plugin data (KV store, settings, custom files)
    package.json          # Plugin dependencies (bun install runs on load)
```

### Lifecycle

1. **Discovery** — `scanPlugins()` in `loader.ts` scans `~/.agemon/plugins/` and `plugins/` (repo-bundled). Reads `agemon-plugin.json` from each directory. First occurrence wins (user plugins override bundled).

2. **Dependency install** — If a `package.json` exists, `bun install` runs automatically.

3. **Loading** — If the manifest declares an `entryPoint`, the module is imported and `onLoad(ctx: PluginContext)` is called. The plugin returns `PluginExports` describing its capabilities.

4. **Registration** — Loaded plugins are stored in a global registry (`registry.ts`). Agent providers are registered in the `AgentRegistry`. Skills are symlinked.

5. **Route mounting** — `mountPluginRoutes()` in `mount.ts` mounts each plugin's `apiRoutes` Hono sub-app onto the main Hono app under `/api/`. Also registers generic endpoints: `GET /api/plugins`, `GET/POST /api/plugins/:id/settings`, `PATCH /api/plugins/:id`.

6. **Renderer build** — `buildPluginRenderers()` in `builder.ts` runs each plugin's build script (`bun run build`), then loads the compiled JS from `dist/renderers/` into an in-memory cache with SHA-256 content hashes.

7. **Hot reload** — File watchers on each plugin's `renderers/` directory trigger rebuild + cache refresh on TSX changes. A directory watcher on `~/.agemon/plugins/` detects new plugins and hot-loads them without restart.

### Key Files

| File | Role |
|---|---|
| `backend/src/lib/plugins/types.ts` | Core interfaces: `PluginModule`, `PluginContext`, `PluginExports`, `PluginStore`, `LoadedPlugin` |
| `backend/src/lib/plugins/loader.ts` | Plugin discovery, dependency install, `onLoad()` invocation, skill wiring |
| `backend/src/lib/plugins/mount.ts` | Mounts plugin API routes onto Hono app, serves plugin list/settings endpoints |
| `backend/src/lib/plugins/builder.ts` | Builds plugin renderers, in-memory caching, file watching, hot reload |
| `backend/src/lib/plugins/registry.ts` | Global plugin registry with lookup by ID, message type, or page path |
| `backend/src/lib/plugins/event-bridge.ts` | Hook/listener event system for cross-plugin communication |
| `backend/src/lib/plugins/agent-registry.ts` | Registry for agent providers (built-in + plugin-contributed) |
| `backend/src/lib/plugins/workspace.ts` | `WorkspaceProvider` interface for controlling agent working directories |
| `backend/src/lib/plugins/workspace-registry.ts` | Registry for workspace providers |
| `backend/src/lib/plugins/workspace-default.ts` | Default workspace provider (task dir + git worktrees) |
| `backend/src/routes/renderers.ts` | HTTP endpoints serving compiled renderer/page/icon JS to the frontend |
| `frontend/src/routes/plugin.tsx` | Generic plugin page component — fetches + renders plugin page JS |
| `frontend/src/main.tsx` | Exposes `window.__AGEMON__` globals (React, ReactDOM, jsxRuntime, LucideReact, onWsEvent) |
| `frontend/src/App.tsx` | TanStack Router setup with `/p/$pluginId` and `/p/$pluginId/$` routes; dynamic bottom nav from plugin manifests |
| `shared/types/plugin.ts` | Shared TypeScript types: `PluginManifest`, `PluginNavItem`, `InputExtensionManifest`, `CustomRendererManifest` |

---

## 2. Extension Points

### 2.1 Backend: API Routes

**Mechanism:** Plugin returns `exports.apiRoutes` (a Hono sub-app). Mounted directly under `/api/` via `app.route('/api', plugin.exports.apiRoutes)`.  
**Also available:** Dynamic dispatch at `/api/plugins/:pluginId/*` strips the prefix and forwards to the plugin's sub-app.  
**Example:** The tasks plugin registers `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, etc. These become `/api/tasks`, `/api/tasks/:id`, etc.

### 2.2 Frontend: Full Pages

**Mechanism:** Plugin returns `exports.pages` — an array of `{ path, component }`. The `component` name maps to a TSX file in `renderers/`. At runtime, the frontend fetches `/api/renderers/pages/:pluginId/page.js` which returns the compiled JS. The component is loaded via dynamic `import()` of a blob URL.  
**Routing:** TanStack Router catches `/p/$pluginId` and `/p/$pluginId/$` (splat). The `PluginPage` component extracts the path and fetches the right component.  
**Navigation:** Plugins declare `navItems` in the manifest. The bottom nav dynamically fetches `/api/plugins` and renders nav entries with Lucide icons or custom icon components.  
**Example:** Tasks plugin has `pages: [{ path: '/', component: 'page' }]` → `renderers/page.tsx` renders the full task list/detail UI.

### 2.3 Frontend: Chat Renderers

**Mechanism:** Plugin returns `exports.renderers` — array of `{ manifest: { name, messageType }, component }`. When a chat message has `eventType` matching `messageType`, the frontend fetches the compiled renderer JS and renders it inline.  
**Status:** The infrastructure is fully wired but no current plugin uses custom chat renderers.

### 2.4 Frontend: Input Extensions

**Mechanism:** Declared in `manifest.inputExtensions` — each entry adds an icon to the chat input toolbar. Clicking it loads the plugin's compiled component.  
**Example:** voice-input plugin adds a microphone icon that loads `renderers/voice-input.tsx`.

### 2.5 Backend: Event Hooks

**Mechanism:** `ctx.hook(event, handler, { priority })` registers a blocking hook (awaited in priority order). `ctx.on(event, handler)` registers a fire-and-forget listener. `ctx.emit(event, payload)` triggers both.  
**Implementation:** `EventBridge` class — hooks are sorted by priority and awaited sequentially; listeners are called fire-and-forget with error isolation.  
**Cleanup:** `removePlugin(pluginId)` strips all hooks/listeners for a plugin (used before hot-reload).  
**Example:** Tasks plugin uses `ctx.on('session:state_changed', ...)` to derive task status when sessions start/stop.

### 2.6 Backend: WebSocket Broadcast

**Mechanism:** `ctx.broadcast(wsEvent)` sends a typed event to all connected WebSocket clients.  
**Example:** Tasks plugin broadcasts `{ type: 'task_updated', task }` after CRUD operations.

### 2.7 Backend: Session Control

**Mechanism:** `ctx.createSession({ agentType, meta })` creates a session record; `ctx.spawnSession(sessionId)` spawns the agent process and runs the ACP handshake.  
**Status:** Available in the context but not used by any current plugin (sessions are created via the core REST API).

### 2.8 Backend: Agent Providers

**Mechanism:** Plugin returns `exports.agentProviders` — array of `{ id, config: AgentConfig }`. Registered in the global `AgentRegistry` during load.  
**Status:** The registry is wired and built-in agents are registered, but no plugin currently contributes additional agent types.

### 2.9 Agent Skills

**Mechanism:** Manifest declares `skills: ["skill-name"]`. During load, `skills/skill-name/` is symlinked to `~/.agemon/skills/{pluginId}--{skillName}/`. Agents discover skills via the standard agentskills.io convention.  
**Example:** memory-cms ships `skills/memory-recall/SKILL.md`.

### 2.10 Persistent Storage

**Mechanism:** Three layers:
- `ctx.store` — simple KV backed by `~/.agemon/plugins/{id}/data/store.json`
- `ctx.getSetting(key)` / `ctx.setSetting(key, value)` — per-plugin settings with env var override (`AGEMON_PLUGIN_{ID}_{KEY}`)
- `ctx.pluginDataDir` — raw filesystem access to `~/.agemon/plugins/{id}/data/`
- `ctx.atomicWrite(path, data)` — POSIX-safe atomic file writes

### 2.11 Settings UI

**Mechanism:** Manifest declares `settings` array with `{ key, label, type, required, description }`. The frontend auto-generates a settings form. Values are stored in `data/settings.json` and can be overridden by env vars. The `configured` flag is computed from required settings.  
**Custom UI:** `manifest.settingsRenderer` can point to a custom component instead of the auto-generated form.

### 2.12 Frontend Globals Available to Plugin Renderers

`window.__AGEMON__` exposes:
- `React` — full React module
- `ReactDOM` — full ReactDOM module
- `jsxRuntime` — merged prod + dev JSX runtimes
- `LucideReact` — full Lucide icon library
- `onWsEvent(handler)` — subscribe to WebSocket server events; returns unsubscribe function

---

## 3. Current Plugins

| Plugin | Type | Nav | API Routes | Pages | Renderers | Skills | Notes |
|---|---|---|---|---|---|---|---|
| **tasks** | Core UI + CRUD | ✅ (CheckSquare icon) | Full task CRUD, events | `page.tsx` (list + detail + kanban) | — | — | Imports core internals directly |
| **memory-cms** | Content viewer | ✅ (Brain icon) | File discovery, content read | `memory-view.tsx` | — | memory-recall | Clean ctx-only plugin |
| **mcp-server** | Integration | — | MCP protocol endpoint | — | — | — | Exposes agemon as MCP server |
| **mcp-config** | Settings | — | MCP server CRUD | — | — | — | Manages MCP server configs for agents |
| **skills-manager** | Settings | — | Skills CRUD | — | — | — | Manages agent skills |
| **voice-input** | Input extension | — | — | — | `voice-input.tsx` | — | Adds mic button to chat input |

---

## 4. Gaps and Improvement Suggestions

### 4.1 Cross-Plugin Queries — Declared But Not Wired

**Problem:** `PluginExports.queries` is defined in `types.ts`:
```typescript
queries?: Record<string, (...args: unknown[]) => unknown>;
```
The comment says "exposed to other plugins via `ctx.query(pluginId, name, ...args)`" — but **`PluginContext` has no `query()` method**. No plugin exports queries. This is dead code.

**Suggestion:** Either implement `ctx.query()` in `loader.ts` (two-pass load: first pass collects exports, second pass builds context with query access to other plugins' exports) or remove the type to avoid confusion. If implemented, it enables plugins to call each other without HTTP overhead — e.g., a notifications plugin querying the tasks plugin for active tasks.

---

### 4.2 First-Party Plugins Import Core Internals Directly

**Problem:** The tasks plugin bypasses `PluginContext` entirely for most operations:
```typescript
import { db, generateTaskId } from '../../backend/src/db/client.ts';
import { getActiveSession, stopAgent } from '../../backend/src/lib/acp/index.ts';
import { archiveSessionsByTask } from '../../backend/src/db/sessions.ts';
import { gitManager } from '../../backend/src/lib/git.ts';
import { refreshTaskContext } from '../../backend/src/lib/context.ts';
import { sendError, validateTaskFields, ... } from '../../backend/src/routes/shared.ts';
```

This creates tight coupling to internal file paths and module shapes. A third-party plugin installed from npm or a separate repo cannot use these imports.

**Suggestion:** Expand `PluginContext` to expose the capabilities plugins actually need:
```typescript
interface PluginContext {
  // ... existing ...
  db: {
    listTasks(includeArchived?: boolean): Task[];
    getTask(id: string): Task | null;
    createTask(data: CreateTaskBody): Task;
    updateTask(id: string, data: UpdateTaskBody): Task | null;
    deleteTask(id: string): void;
    listSessions(taskId?: string, includeArchived?: boolean): AgentSession[];
    // ...
  };
  sessions: {
    getActive(taskId: string): AgentSession | null;
    stop(sessionId: string): void;
  };
  git: {
    createWorktree(taskId: string, repoUrl: string): Promise<void>;
    deleteTaskWorktrees(taskId: string): Promise<void>;
  };
}
```

This would let the tasks plugin (and future plugins) work through the official API. The mcp-server plugin already demonstrates the right pattern — it talks to the core via HTTP.

---

### 4.3 No Plugin Lifecycle Hooks (onUnload / onDisable)

**Problem:** Plugins get `onLoad()` but there's no corresponding `onUnload()` or `onDisable()`. The hot-reload path in `watchPluginsDir` only handles **new** plugins. A comment in `builder.ts` acknowledges: "Removed plugins are not unloaded (Hono routes can't be unregistered; restart required for removal)."

**Impact:** Plugins that allocate resources (timers, file watchers, DB connections, in-memory caches) can't clean them up on unload. The EventBridge's `removePlugin()` handles hook cleanup, but plugin-internal resources leak.

**Suggestion:** Add `onUnload?(): void | Promise<void>` to `PluginModule`. Call it during hot-reload before re-importing the module, and on server shutdown. Even if Hono routes can't be unregistered, plugin-internal cleanup would work.

---

### 4.4 Limited Bridge Events from Core

**Problem:** The EventBridge currently only emits one event from the core:
- `session:state_changed` — emitted from `lifecycle.ts`, `handshake.ts`, `resume.ts`, `prompt.ts`

There are no bridge events for:
- Task created / updated / deleted
- Session created / spawned
- Approval requested / resolved
- Agent message received
- Turn started / completed / cancelled

Plugins wanting to react to these must poll the API.

**Suggestion:** Emit bridge events alongside existing WebSocket broadcasts. The broadcast function in `app.ts` already creates the event objects — add a `bridge.emit()` call next to each `broadcast()`. Suggested events:
- `task:created`, `task:updated`, `task:deleted`
- `session:created`, `session:spawned`
- `approval:requested`, `approval:resolved`
- `agent:message` (with sessionId, content, eventType)
- `turn:completed`, `turn:cancelled`

---

### 4.5 Plugin Pages Use Internal pushState Router

**Problem:** The tasks plugin implements its own SPA router:
```typescript
const PREFIX = '/p/tasks';
function navigate(path: string): void {
  window.history.pushState(null, '', PREFIX + (path === '/' ? '' : path));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
```

This conflicts with TanStack Router. When the plugin's `<a href="/sessions?taskId=...">` link triggers a full page load, TanStack Router loses the pushState entries. Back navigation from the new page can land on a pushState'd URL that TanStack Router handles as a fresh load (causing the 404 issues fixed in commit `451a730`).

**Suggestion:** Expose TanStack Router's `navigate` function in `window.__AGEMON__`:
```typescript
(window as any).__AGEMON__ = {
  // ... existing ...
  navigate: (opts: NavigateOptions) => router.navigate(opts),
};
```

This would let plugin pages do client-side navigation without full reloads. For backward compatibility, plugin pages that use `pushState` would still work, but cross-route links (like "Sessions") should use the host router.

---

### 4.6 No Dependency Declaration Between Plugins

**Problem:** There's no `depends` field in the manifest. `scanPlugins()` loads plugins in directory-listing order (`readdir`), which is filesystem-dependent and effectively alphabetical. If plugin A needs plugin B's queries or expects B's hooks to be registered first, there's no guarantee.

**Suggestion:** Add an optional `depends?: string[]` field to `PluginManifest`. In `scanPlugins()`, do a topological sort before calling `onLoad()`. Fail with a clear error if dependencies are missing or circular.

---

### 4.7 WorkspaceProvider Not Exposed to Plugins

**Problem:** The `WorkspaceProvider` interface and `workspaceRegistry` exist and the default provider is registered in `server.ts`, but `PluginContext` doesn't expose the registry. A plugin can't register a custom workspace provider.

**Impact:** Can't implement alternative execution environments (Docker containers, remote VMs, Nix shells, devcontainers) as plugins — requires modifying core server code.

**Suggestion:** Add `ctx.workspaces.register(id, provider)` to `PluginContext`. The workspace registry already exists; it just needs to be exposed.

---

### 4.8 No Plugin API Versioning

**Problem:** There's no `minAgemonVersion`, `apiVersion`, or `pluginApiVersion` field in the manifest. If the `PluginContext` interface changes (methods renamed, removed, or signatures altered), old plugins break silently at runtime.

**Suggestion:** Add `apiVersion: number` to the manifest (start at `1`). The loader checks compatibility and warns or skips incompatible plugins. When the `PluginContext` interface has a breaking change, bump the version.

---

### 4.9 Duplicated Build Scripts Across Plugins

**Problem:** `tasks/build.ts`, `memory-cms/build.ts`, and `voice-input/build.ts` are nearly identical (~60 lines each). They all define the same `EXTERNAL_MAP`, the same `agemonExternalsPlugin` Bun plugin, and the same `Bun.build()` call. Only the plugin name in log messages differs.

**Suggestion:** Extract a shared build utility:
```typescript
// e.g. shared/plugin-build.ts or @agemon/plugin-build
export async function buildPluginRenderers(pluginDir: string, pluginName: string): Promise<void> {
  // ... shared EXTERNAL_MAP, agemonExternalsPlugin, Bun.build() ...
}
```

Plugin build scripts become one-liners:
```typescript
import { buildPluginRenderers } from '../../shared/plugin-build';
await buildPluginRenderers(import.meta.dir, 'memory-cms');
```

---

### 4.10 No Plugin Sandboxing on Frontend

**Problem:** Plugin renderer TSX is compiled to JS, fetched via `/api/renderers/`, and loaded via dynamic `import()` of a blob URL in the **main window context**. A plugin component has full access to:
- `localStorage` (including `agemon_key`)
- All cookies
- The full DOM
- `window.__AGEMON__` (React, WebSocket subscription)
- `fetch()` with credentials (cookie auth)

**Impact:** For the current first-party plugins this is fine. For a community plugin ecosystem, a malicious plugin could exfiltrate the API key or manipulate other plugins' UI.

**Suggestion (long-term):** Render plugin pages in sandboxed iframes with `postMessage`-based communication. The host app would proxy API calls and WebSocket events. This is a significant architectural change but standard in extensible web apps (VS Code webviews, Figma plugins, Shopify apps).

**Suggestion (short-term):** Document the trust model — make it clear that installing a plugin grants it full access. Add a `trusted: boolean` field to manifests; only load untrusted plugins with user confirmation.

---

### 4.11 Plugin Page Component Cannot Access Host UI Primitives

**Problem:** Plugin pages only get `React`, `ReactDOM`, `jsxRuntime`, and `LucideReact` from the host. They cannot use:
- shadcn/ui components (`Button`, `Badge`, `Input`, etc.)
- Utility functions (`api.ts`, `formatDuration`, `friendlyError`)
- TanStack Router hooks (`useNavigate`, `useParams`)
- TanStack Query (`useQuery`, `queryClient`)

**Impact:** The tasks plugin reimplements its own buttons, cards, and data fetching. The memory-cms plugin does the same. There's no visual consistency guarantee.

**Suggestion:** Expose a curated set of UI primitives on `window.__AGEMON__`:
```typescript
(window as any).__AGEMON__ = {
  // ... existing ...
  ui: { Button, Badge, Input, Card, ... },  // shadcn components
  api: { fetch: api.fetch },                 // authenticated fetch wrapper
  router: { navigate, useParams },           // TanStack Router
  query: { useQuery, queryClient },          // TanStack Query
};
```

This ensures visual consistency, reduces plugin bundle sizes, and gives plugins access to authenticated API calls without handling auth themselves.

---

### 4.12 No Plugin Marketplace / Discovery Mechanism

**Problem:** Plugins must be manually placed in `~/.agemon/plugins/` (or symlinked by the install script). There's no `agemon plugin install <name>` CLI, no plugin registry, and no way to browse/install plugins from the UI.

**Suggestion (future):** Add a `plugins install <git-url>` command that clones a plugin repo into `~/.agemon/plugins/` and runs the load cycle. A settings page could list available community plugins from a curated registry.

---

## 5. Prioritized Recommendations

| Priority | Item | Effort | Impact | Status |
|---|---|---|---|---|
| **P0** | 4.2 — Expand PluginContext to reduce direct core imports | Medium | High — unblocks third-party plugins | 🔲 Partial — ctx expanded but tasks plugin still imports core directly |
| **P0** | 4.9 — Extract shared build utility | Low | Medium — reduces maintenance burden | ✅ Done — `shared/plugin-build.ts`, all plugin build.ts files shrunk to 2 lines |
| **P1** | 4.4 — Emit more bridge events from core | Low | High — makes hook system useful | ✅ Done — `task:created`, `task:updated`, `task:deleted` emitted from tasks plugin |
| **P1** | 4.1 — Wire up cross-plugin queries | Low | Medium — enables plugin composition | ✅ Done — `ctx.query(pluginId, name, ...args)` implemented in loader.ts |
| **P1** | 4.5 — Expose host router to plugin pages | Low | Medium — fixes navigation friction | ✅ Done — `window.__AGEMON__.navigate` exposed via TanStack Router |
| **P1** | 4.11 — Expose UI primitives to plugins | Medium | High — visual consistency + smaller bundles | ✅ Done — `window.__AGEMON__.ui`, `host` (SessionList/ChatPanel/StatusBadge), PluginKitContext |
| **P2** | 4.3 — Add onUnload lifecycle hook | Low | Medium — cleaner hot reload | ✅ Done — `onUnload?()` added to PluginModule interface |
| **P2** | 4.7 — Expose workspace registry to plugins | Low | Medium — enables execution env plugins | ✅ Done — `ctx.workspaces` (WorkspaceRegistry) in PluginContext |
| **P2** | 4.6 — Plugin dependency declaration | Low | Low — prevents ordering bugs | ✅ Done — `depends?: string[]` in PluginManifest (declaration only, topological sort not yet enforced) |
| **P2** | 4.8 — Plugin API versioning | Low | Low — prevents silent breakage | ✅ Done — `apiVersion?: number` in PluginManifest (declaration only, mismatch warning not yet emitted) |
| **P3** | 4.10 — Plugin sandboxing | High | Medium — only matters for untrusted plugins | 🔲 Deferred |
| **P3** | 4.12 — Plugin marketplace | High | Medium — only matters at ecosystem scale | 🔲 Deferred |

### Additional work completed (beyond audit scope)

| Item | Description |
|---|---|
| **Plugin URL namespace** | Removed first-class `/api` mounting — all plugin routes now exclusively under `/api/plugins/:id/*`. Frontend `api.ts` updated. |
| **PluginKit context bridge** | `PluginKitContext` React context exposes `SessionList`, `ChatPanel`, `StatusBadge` to plugin pages. `@agemon/host` external added to build pipeline. |
| **Tasks plugin fully self-contained** | Deleted host routes `kanban.tsx`, `tasks.new.tsx`. `tasks.$id.tsx` is now a redirect. Tasks plugin owns all task UI including composed workspace (list + kanban + create + detail). |
| **`/tasks/$id` → `/p/tasks/:id`** | Deep links redirect to plugin route. Dashboard navigation updated. |

---

## 6. Conclusion

The plugin system is well-architected for a v2 milestone. The `PluginContext` API, EventBridge, renderer build pipeline, and hot-reload infrastructure provide a solid foundation. The six bundled plugins demonstrate real-world usage of most extension points (API routes, pages, input extensions, skills, event hooks, WebSocket broadcast).

The primary gap is that the **official plugin API (`PluginContext`) is too narrow** — first-party plugins work around it by importing core internals, which makes the plugin boundary more of a code organization tool than a true extension API. Expanding `PluginContext` to cover what plugins actually need (DB access, session control, git operations, workspace registration, cross-plugin queries) would make the system genuinely extensible by third parties.

The secondary gap is **frontend integration** — plugin pages run in the host context but can't access host UI components or routing, leading to duplicated UI code and navigation conflicts. Exposing a curated set of host capabilities via `window.__AGEMON__` would solve this incrementally.

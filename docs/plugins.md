# Plugin System

Agemon's plugin system is the primary extension mechanism. Almost all product features — tasks, MCP config, skills manager, voice input — are implemented as plugins.

**Core = session engine + event bridge + plugin host. Everything else is a plugin.**

---

## Plugin Structure

```
plugins/my-plugin/
  agemon-plugin.json    # Required: manifest
  index.ts              # Optional: backend entry point
  renderers/            # Optional: TSX components compiled to browser ESM
    page.tsx
    icon.tsx
  build.ts              # Bun.build script (uses shared/plugin-build.ts)
  dist/renderers/       # Build output (cached in memory by builder.ts)
  skills/               # Agent-discoverable skills
    my-skill/
      SKILL.md
  data/                 # Runtime data dir (~/.agemon/plugins/{id}/data/)
  package.json          # Plugin dependencies (auto-installed on load)
```

Bundled plugins live in `plugins/` in the repo. User plugins live in `~/.agemon/plugins/`. User plugins take precedence over bundled ones with the same ID.

---

## Lifecycle

1. **Discovery** — `scanPlugins()` scans `~/.agemon/plugins/` and `plugins/`. Reads `agemon-plugin.json`. First occurrence wins (user > bundled).
2. **Dependency install** — `bun install` runs automatically if `package.json` exists.
3. **Loading** — If `entryPoint` is declared, the module is imported and `onLoad(ctx)` is called. The plugin returns `PluginExports`.
4. **Registration** — Plugin stored in the global registry. Skills symlinked. Agent providers registered.
5. **Route mounting** — `apiRoutes` sub-app mounted at `/api/plugins/{id}/`. Generic endpoints (`GET/POST /api/plugins/:id/settings`, `PATCH /api/plugins/:id`) are always available.
6. **Renderer build** — `buildPluginRenderers()` runs each plugin's build script, caches compiled JS in memory.
7. **Hot reload** — File watchers on `renderers/` trigger rebuild + cache refresh on TSX changes. A directory watcher on `~/.agemon/plugins/` hot-loads new plugins without restart.

---

## Manifest (`agemon-plugin.json`)

```jsonc
{
  "id": "my-plugin",           // unique slug
  "name": "My Plugin",         // human-readable
  "version": "0.1.0",
  "description": "...",
  "entryPoint": "index.ts",    // backend entry, optional
  "hasPages": true,            // true = plugin serves full pages at /p/{id}/
  "apiVersion": 1,             // plugin API version (warn if mismatch)
  "depends": ["tasks"],        // load after these plugins

  // Bottom nav entries
  "navItems": [
    { "label": "My Plugin", "lucideIcon": "Star", "path": "/", "order": 50 }
  ],

  // Settings schema (auto-generates settings form)
  "settings": [
    { "key": "api_key", "label": "API Key", "type": "secret", "required": true }
  ],

  // Skills to symlink into ~/.agemon/skills/
  "skills": ["my-skill"],

  // Input toolbar extensions
  "inputExtensions": [
    { "id": "voice", "label": "Voice Input", "lucideIcon": "Mic", "component": "voice-input" }
  ],

  "showInSettings": true       // show in Settings → Plugins (default: true)
}
```

---

## `PluginContext` API

Passed to `onLoad(ctx)`. All context methods are synchronous unless noted.

```typescript
interface PluginContext {
  agemonDir: string;          // ~/.agemon/
  pluginDir: string;          // directory containing the plugin
  pluginDataDir: string;      // ~/.agemon/plugins/{id}/data/

  // Storage
  store: PluginStore;                         // KV store → store.json
  getSetting(key: string): string | null;     // settings.json + env var override
  setSetting(key: string, value: string): void;
  atomicWrite(path: string, data: string): void;
  coreDb: Database;            // in-memory SQLite (READ-ONLY by convention)

  // EventBridge
  hook(event: string, handler: (payload) => Promise<void>, opts?: { priority?: number }): void;
  on(event: string, handler: (payload) => void): void;
  emit(event: string, payload: unknown): Promise<void>;

  // WebSocket
  broadcast(wsEvent: ServerEventPayload): void;

  // Session control
  createSession(opts: { agentType, meta }): AgentSession;
  spawnSession(sessionId: string): AgentSession;

  // Cross-plugin queries
  query(pluginId: string, name: string, ...args: unknown[]): unknown;

  // Workspace registry
  workspaces: WorkspaceRegistry;

  logger: PluginLogger;
}
```

**Setting env var override:** `AGEMON_PLUGIN_{ID_UPPERCASE}_{KEY_UPPERCASE}` overrides any stored value. Useful for CI / secrets management.

---

## `PluginExports`

Returned from `onLoad()`. All fields are optional.

```typescript
interface PluginExports {
  apiRoutes?: Hono;          // mounted at /api/plugins/{id}/
  pageRoutes?: Hono;         // full-page HTML at /p/{id}/ (rare)
  pages?: PluginPage[];      // React pages rendered inside the main SPA
  renderers?: CustomRenderer[]; // chat message renderers
  agentProviders?: AgentProvider[];
  queries?: Record<string, (...args) => unknown>; // callable by other plugins
  onUnload?(): void | Promise<void>;  // cleanup on hot-reload / shutdown
}
```

---

## Extension Points

### API Routes
Return `exports.apiRoutes` (a Hono sub-app). Requests arrive at `/api/plugins/{id}/<your-path>`.

```typescript
const app = new Hono();
app.get('/items', (c) => c.json(listItems()));
exports = { apiRoutes: app };
```

### Full Pages (SPA)
Declare `pages` in exports. The component name maps to a TSX file in `renderers/`. The frontend fetches compiled JS from `/api/renderers/pages/{id}/{component}.js` and mounts it.

```typescript
// exports
pages: [{ path: '/', component: 'page' }]
// renderers/page.tsx → compiled and served as browser ESM
```

### Chat Renderers
Return `exports.renderers` with `{ manifest: { messageType }, component }`. When a chat message's `eventType` matches, the compiled component renders inline.

### Input Extensions
Declare `inputExtensions` in the manifest. Each adds an icon to the chat input toolbar. Clicking loads and shows the component from `renderers/`.

### Event Hooks
- `ctx.hook(event, handler, { priority })` — blocking; awaited before event resolves
- `ctx.on(event, handler)` — fire-and-forget listener
- `ctx.emit(event, payload)` — trigger hooks and listeners

**Core events currently emitted:**
- `session:state_changed` — from `lifecycle.ts`, `handshake.ts`, `prompt.ts`, `resume.ts`

**Plugin-emitted events (tasks plugin):**
- `task:created`, `task:updated`, `task:deleted`

### WebSocket Broadcast
`ctx.broadcast(wsEvent)` sends a typed event to all connected clients immediately.

### Cross-Plugin Queries
Export named functions via `exports.queries`. Call them from another plugin via `ctx.query(pluginId, name, ...args)`.

### Skills
Declare `skills` in the manifest. Each entry symlinks `skills/{name}/` into `~/.agemon/skills/{id}--{name}/`. Agents discover skills via the [Agent Skills spec](https://agentskills.io/specification).

### Workspace Providers
Register a custom execution environment:
```typescript
ctx.workspaces.register('my-env', {
  resolvePath(taskId: string) { return `/sandboxes/${taskId}`; }
});
```

### Agent Providers
Return `exports.agentProviders` to contribute new agent types to the `AgentRegistry`.

---

## Frontend: Renderer Build

Plugin renderer TSX files are compiled to browser ESM using `shared/plugin-build.ts`:

```typescript
// build.ts (2 lines)
import { buildPlugin } from '../../shared/plugin-build.ts';
await buildPlugin(import.meta.dir, 'my-plugin');
```

React, ReactDOM, Lucide icons, and host components are **not bundled** — they're resolved at runtime from `window.__AGEMON__`. This keeps plugin bundles small and ensures a single React instance.

---

## Frontend Globals (`window.__AGEMON__`)

Available to all plugin renderer TSX files. Import via `@agemon/host` (resolved externally):

```typescript
// In renderer TSX — these map to window.__AGEMON__ at runtime
const { React, LucideReact, navigate, onWsEvent } = (window as any).__AGEMON__;

// Host UI components (shadcn/ui + app primitives)
import { Button, Badge } from '@agemon/host';
// → window.__AGEMON__.ui.Button, etc.

// Host app components
import { SessionList, ChatPanel, StatusBadge } from '@agemon/host';
// → window.__AGEMON__.host.SessionList, etc.
```

| Key | Type | Description |
|-----|------|-------------|
| `React` | React module | Full React |
| `ReactDOM` | ReactDOM module | Full ReactDOM |
| `jsxRuntime` | merged runtime | Prod + dev JSX runtimes |
| `LucideReact` | Lucide icons | Full icon library |
| `navigate(opts)` | `(NavigateOptions) => void` | TanStack Router navigate |
| `onWsEvent(handler)` | `(handler) => unsubscribe` | Subscribe to WS server events |
| `ui.*` | shadcn components | `Button`, `Badge`, `Input`, `Card`, etc. |
| `host.SessionList` | React component | Session list for a task |
| `host.ChatPanel` | React component | Full chat panel |
| `host.StatusBadge` | React component | Task status badge |

---

## Trust Model

Plugin renderer TSX runs in the **main window context** with full access to `localStorage`, all cookies, the DOM, and the API. Installing a plugin grants it full trust — equivalent to running arbitrary code.

For first-party and trusted internal plugins this is fine. For community plugins, treat installation as equivalent to `npm install` from an unknown author.

**Not yet implemented:** Sandboxed iframe rendering with `postMessage` bridge (deferred — high effort, only matters at community-plugin scale).

---

## Bundled Plugins

| Plugin | Nav | API Routes | Pages | Input Ext | Skills |
|--------|-----|-----------|-------|-----------|--------|
| **tasks** | ✅ | Full task + session CRUD | `page.tsx` (list/kanban/detail) | — | — |
| **memory-cms** | ✅ | File discovery, content read | `memory-view.tsx` | — | memory-recall |
| **mcp-config** | — | MCP server CRUD | — | — | — |
| **skills-manager** | — | Skills CRUD | — | — | — |
| **voice-input** | — | — | — | `voice-input.tsx` | — |

---

## Known Limitations / Roadmap

**First-party plugins import core internals directly**
The `tasks` plugin imports `db/client.ts`, `lib/acp/index.ts`, `lib/git.ts`, etc. instead of going through `PluginContext`. This works for bundled plugins but means the official plugin API is narrower than what's actually possible. `PluginContext` needs `db`, `sessions`, and `git` sub-objects to eliminate these internal imports and enable genuine third-party plugins.

**`depends` declaration is not enforced**
The `depends?: string[]` manifest field is declared and stored but the loader does not yet perform a topological sort. Plugins load in filesystem order.

**`apiVersion` mismatch is not warned**
The `apiVersion?: number` field is declared but the loader does not yet emit a warning when the plugin's declared version differs from the runtime.

**No sandboxing**
See Trust Model above.

**No marketplace / install CLI**
Plugins must be manually placed in `~/.agemon/plugins/`. There is no `agemon plugin install <url>` command or discovery UI.

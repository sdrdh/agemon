# Extension System

Agemon's extension system is the primary extensibility mechanism. Almost all product features — tasks, MCP config, skills manager, voice input — are implemented as extensions.

**Core = session engine + event bridge + extension host. Everything else is an extension.**

---

## Extension Structure

```
extensions/my-extension/
  agemon-extension.json    # Required: manifest (activation signal — absence = draft mode)
  index.ts                 # Optional: backend entry point
  renderers/               # Optional: TSX components compiled to browser ESM
    page.tsx
    icon.tsx
  build.ts                 # Bun.build script (uses shared/plugin-build.ts)
  dist/renderers/          # Build output (cached in memory by builder.ts)
  skills/                  # Agent-discoverable skills
    my-skill/
      SKILL.md
  agent-plugins/           # Agent-specific plugin directories
    claude-code/
  package.json             # Extension dependencies (auto-installed on load)
```

Runtime data lives **outside** the source tree at `~/.agemon/extension-data/{id}/` (separate from the extension directory, never triggers file watchers).

Bundled extensions live in `extensions/` in the repo. User extensions live in `~/.agemon/extensions/`. User extensions take precedence over bundled ones with the same ID (first occurrence wins: user dir scanned first).

### Extension Types

| Type | Condition |
|------|-----------|
| `bundled` | Found in `{repoDir}/extensions/` |
| `installed` | Found in `~/.agemon/extensions/` with a `.git/` directory |
| `local` | Found in `~/.agemon/extensions/` with no `.git/` directory (manually placed or agent-created) |

### Draft Mode

An extension directory without `agemon-extension.json` is ignored entirely. This enables agents to build an extension across multiple steps without triggering premature hot-loads.

- Draft: no `agemon-extension.json` (optionally has `agemon-extension.draft.json` while iterating)
- Active: `agemon-extension.json` present and valid → loaded and watched for changes

---

## Lifecycle

1. **Discovery** — `scanExtensions()` scans `~/.agemon/extensions/` then `{repoDir}/extensions/`. Reads `agemon-extension.json`. Topologically sorted on `depends` before loading.
2. **Dependency install** — `bun install` runs automatically if `package.json` exists.
3. **Loading** — If `entryPoint` is declared, the module is imported and `onLoad(ctx)` is called. The extension returns `ExtensionExports`.
4. **Registration** — Extension stored in global registry. Skills symlinked. Agent plugin symlinks wired.
5. **Route mounting** — `apiRoutes` sub-app mounted at `/api/extensions/{id}/`. Generic endpoints (`GET/POST /api/extensions/:id/settings`, `PATCH /api/extensions/:id`) are always available.
6. **Renderer build** — `buildExtensionRenderers()` runs each extension's build script, caches compiled JS in memory.
7. **Hot reload** — Single recursive watcher on `~/.agemon/extensions/`. Manifest creation/deletion triggers load/unload. Renderer changes trigger rebuild. Skills/agentPlugins changes re-wire symlinks.

---

## Manifest (`agemon-extension.json`)

```jsonc
{
  "id": "my-extension",        // unique slug, kebab-case
  "name": "My Extension",      // human-readable
  "version": "1.0.0",
  "description": "...",
  "entryPoint": "index.ts",    // backend entry, optional
  "hasPages": true,            // true = extension serves full pages at /p/{id}/
  "apiVersion": 1,             // extension API version (warn if mismatch)
  "depends": ["tasks"],        // load after these extensions (topological sort)

  // Bottom nav entries
  "navItems": [
    { "label": "My Extension", "lucideIcon": "Star", "path": "/", "order": 50 }
  ],

  // Settings schema (auto-generates settings form)
  "settings": [
    { "key": "api_key", "label": "API Key", "type": "secret", "required": true }
  ],

  // Skills to symlink into ~/.agemon/skills/
  "skills": ["my-skill"],

  // Agent plugins to wire into each agent's discovery directory
  "agentPlugins": {
    "claude-code": "agent-plugins/claude-code/"
  },

  // Input toolbar extensions
  "inputExtensions": [
    { "id": "voice", "label": "Voice Input", "lucideIcon": "Mic", "component": "voice-input" }
  ],

  "showInSettings": true       // show in Settings → Extensions (default: true)
}
```

---

## `ExtensionContext` API

Passed to `onLoad(ctx)`. All context methods are synchronous unless noted.

```typescript
interface ExtensionContext {
  agemonDir: string;              // ~/.agemon/
  extensionDir: string;           // directory containing the extension source
  extensionDataDir: string;       // ~/.agemon/extension-data/{id}/

  // Storage
  store: ExtensionStore;                      // KV store → store.json
  getSetting(key: string): string | null;     // settings.json + env var override
  setSetting(key: string, value: string): void;
  atomicWrite(path: string, data: string): void;
  coreDb: Database;               // in-memory SQLite (READ-ONLY by convention)

  // EventBridge
  hook(event: string, handler: (payload) => Promise<void>, opts?: { priority?: number }): void;
  on(event: string, handler: (payload) => void): void;
  emit(event: string, payload: unknown): Promise<void>;

  // WebSocket
  broadcast(wsEvent: ServerEventPayload): void;

  // Session control
  createSession(opts: { agentType, meta }): AgentSession;
  spawnSession(sessionId: string): AgentSession;

  // Cross-extension queries
  query(extensionId: string, name: string, ...args: unknown[]): unknown;

  // Workspace registry (shared singleton — same instance across all extensions)
  workspaces: WorkspaceRegistry;

  logger: ExtensionLogger;
}
```

**Setting env var override:** `AGEMON_EXTENSION_{ID_UPPERCASE}_{KEY_UPPERCASE}` overrides any stored value. Useful for CI / secrets management.

---

## `ExtensionExports`

Returned from `onLoad()`. All fields are optional.

```typescript
interface ExtensionExports {
  apiRoutes?: Hono;               // mounted at /api/extensions/{id}/
  pageRoutes?: Hono;              // full-page HTML at /p/{id}/ (rare)
  pages?: ExtensionPage[];        // React pages rendered inside the main SPA
  renderers?: CustomRenderer[];   // chat message renderers
  agentProviders?: AgentProvider[];
  queries?: Record<string, (...args) => unknown>; // callable by other extensions
  onUnload?(): void | Promise<void>;  // cleanup on hot-reload / shutdown
}
```

---

## Extension Points

### API Routes
Return `exports.apiRoutes` (a Hono sub-app). Requests arrive at `/api/extensions/{id}/<your-path>`.

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

**Extension-emitted events (tasks extension):**
- `task:created`, `task:updated`, `task:deleted`

### WebSocket Broadcast
`ctx.broadcast(wsEvent)` sends a typed event to all connected clients immediately.

### Cross-Extension Queries
Export named functions via `exports.queries`. Call them from another extension via `ctx.query(extensionId, name, ...args)`.

### Skills
Declare `skills` in the manifest. Each entry symlinks `skills/{name}/` into `~/.agemon/skills/{id}--{name}/`. Agents discover skills via the [Agent Skills spec](https://agentskills.io/specification).

### Agent Plugins
Declare `agentPlugins` in the manifest. The loader wires symlinks into each agent's discovery directory:
```
~/.claude/plugins/agemon/{extensionId} → {extensionDir}/agent-plugins/claude-code/
```
Wiring happens at startup and after install/upgrade/remove.

### Workspace Providers
Register a custom execution environment via the shared `WorkspaceRegistry`:
```typescript
ctx.workspaces.register('my-env', {
  async prepare(session) { return { cwd: `/sandboxes/${session.id}` }; },
  async getDiff(meta) { return null; },
});
```
The registry is a shared singleton — all extensions see each other's registered providers.

### Agent Providers
Return `exports.agentProviders` to contribute new agent types to the `AgentRegistry`.

---

## REST API (Install / Upgrade / Remove)

All endpoints require `Authorization: Bearer {AGEMON_KEY}`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/extensions` | List all loaded extensions with type and configured state |
| `GET` | `/api/extensions/:id` | Single extension detail |
| `POST` | `/api/extensions/install` | Clone from git URL and load `{ gitUrl }` |
| `POST` | `/api/extensions/:id/upgrade` | `git pull` + reload |
| `DELETE` | `/api/extensions/:id` | Unload, remove symlinks, delete directory |

Install reads `agemon-extension.json` from the cloned repo to determine the ID. Returns `409` if the ID collides with an already-loaded extension.

---

## Frontend: Renderer Build

Extension renderer TSX files are compiled to browser ESM using `shared/plugin-build.ts`:

```typescript
// build.ts (2 lines)
import { buildPlugin } from '../../shared/plugin-build.ts';
await buildPlugin(import.meta.dir, 'my-extension');
```

React, ReactDOM, Lucide icons, and host components are **not bundled** — they're resolved at runtime from `window.__AGEMON__`. This keeps extension bundles small and ensures a single React instance.

---

## Frontend Globals (`window.__AGEMON__`)

Available to all extension renderer TSX files:

```typescript
const { React, LucideReact, navigate, onWsEvent } = (window as any).__AGEMON__;
import { Button, Badge } from '@agemon/host';   // → window.__AGEMON__.ui.*
import { SessionList, ChatPanel } from '@agemon/host'; // → window.__AGEMON__.host.*
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

Extension renderer TSX runs in the **main window context** with full access to `localStorage`, all cookies, the DOM, and the API. Installing an extension grants it full trust — equivalent to running arbitrary code.

For first-party and trusted internal extensions this is fine. For community extensions, treat installation as equivalent to `npm install` from an unknown author.

**Not yet implemented:** Sandboxed iframe rendering with `postMessage` bridge (deferred — high effort, only matters at community-extension scale).

---

## Bundled Extensions

| Extension | Nav | API Routes | Pages | Input Ext | Skills |
|-----------|-----|-----------|-------|-----------|--------|
| **tasks** | ✅ | Full task + session CRUD | `page.tsx` (list/kanban/detail) | — | — |
| **memory-cms** | ✅ | File discovery, content read | `memory-view.tsx` | — | memory-recall |
| **mcp-config** | — | MCP server CRUD | — | — | — |
| **mcp-server** | — | MCP server management | — | — | — |
| **skills-manager** | — | Skills CRUD | — | — | — |
| **voice-input** | — | — | — | `voice-input.tsx` | — |
| **server-logs** | ✅ | Log streaming | `logs-view.tsx` | — | — |

---

## Known Limitations

**First-party extensions import core internals directly**
The `tasks` extension imports `db/client.ts`, `lib/acp/index.ts`, `lib/git.ts`, etc. instead of going through `ExtensionContext`. This works for bundled extensions but means the official extension API is narrower than what's actually possible. `ExtensionContext` needs `db`, `sessions`, and `git` sub-objects to eliminate these internal imports and enable genuine third-party extensions.

**No sandboxing**
See Trust Model above.

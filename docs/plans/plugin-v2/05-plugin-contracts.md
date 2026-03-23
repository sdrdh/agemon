# Plugin System v2 — Plugin Contracts

## Six Plugin Types

A plugin can implement any combination of these. Most plugins implement 2-3.

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

---

## PluginExports Interface

```ts
interface PluginExports {
  // --- Existing (v1) ---
  apiRoutes?: (app: Hono) => void;
  pageRoutes?: RouteConfig[];
  renderers?: CustomRenderer[];       // widened in v2: component gets { message, actions }
  pages?: PluginPage[];

  // --- New (v2) ---
  workspaceProvider?: WorkspaceProvider;
  agentProviders?: AgentProvider[];
  inputExtensions?: InputExtension[];
  queries?: Record<string, (...args: unknown[]) => unknown>;
  hooks?: Record<string, (payload: unknown) => Promise<void>>;   // blocking
  listeners?: Record<string, (payload: unknown) => void>;        // fire-and-forget
}
```

---

## PluginContext Interface

```ts
interface PluginContext {
  // Identity
  agemonDir: string;
  pluginDir: string;
  pluginId: string;

  // Storage
  db: Database;          // plugin's own SQLite at ~/.agemon/plugins/{id}/state.db
  coreDb: Database;      // read-only access to sessions table
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;

  // Logging
  logger: Logger;

  // Event bridge
  hook(event: string, handler: (payload: unknown) => Promise<void>, opts?: { priority?: number }): void;
  on(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
  broadcast(wsEvent: object): void;
}
```

---

## AgentProvider Interface

Inspired by pi-mono's `AgentLoopConfig` and `createAgentSession` patterns. Rather than one mega config, Agemon's AgentProvider is about resolving a CLI command.

```ts
interface AgentProvider {
  id: string;          // "claude-code", "opencode", "gemini-cli", etc.
  displayName: string;
  icon?: string;

  // Build the spawn command for a session
  buildCommand(session: SessionMeta, cwd: string): AgentCommand;

  // Parse stdout/stderr to extract ACP events
  // Some agents emit ACP natively; others need output parsing
  parseOutput?: (line: string) => AcpEvent | null;

  // Paths this agent auto-loads context from (e.g. ["CLAUDE.md", ".claude/"])
  autoLoadsContextFile?: string[];

  // Plugin/skill discovery paths this agent supports
  pluginPaths?: string[];
  skillPaths?: string[];
}

interface AgentCommand {
  executable: string;
  args: string[];
  env: Record<string, string>;
}
```

**Registration:**

```ts
// In plugin's onLoad:
ctx.registerAgentProvider({
  id: "claude-code",
  displayName: "Claude Code",
  buildCommand(session, cwd) {
    return {
      executable: "claude",
      args: ["--dangerously-skip-permissions"],
      env: { ANTHROPIC_API_KEY: ctx.getSetting("anthropic_api_key") ?? "" },
    };
  },
  autoLoadsContextFile: ["CLAUDE.md"],
  skillPaths: [".claude/skills/"],
});
```

**Multiple providers, model cycling (from pi-mono):**

A session can have `agentProviders: string[]` in its meta. The UI shows a provider switcher. Switching mid-session is a new session spawn with the same workspace, same task — just different agent. The "cycling" workflow from pi-mono (Ctrl+P) maps to a session-level action.

---

## Renderer Interface (Widened)

v1 renderers get `{ message }`. v2 widens to include `actions`:

```ts
interface CustomRenderer {
  messageType: string;
  component: React.ComponentType<RendererProps>;
}

interface RendererProps {
  message: AcpEvent;
  actions: ChatActions;
}

interface ChatActions {
  sendMessage: (text: string) => void;
  sendMessageWithAttachment: (text: string, file: File) => void;
  showToast: (message: string, variant?: "default" | "destructive") => void;
  navigate: (path: string) => void;
  openModal: (content: React.ReactNode) => void;
}
```

This enables interactive renderers: a `diff_ready` renderer with "Approve / Reject" buttons that send a response back to the session, or a `task_created` renderer that navigates to the task detail page.

---

## InputExtension Interface

New slot for adding buttons to the chat input toolbar:

```
[ 📎 ] [ 🎤 ] [ textarea                    ] [ ▶ send ]
  ↑      ↑
  file   voice
  plugin plugin
```

```ts
interface InputExtension {
  id: string;
  icon: string;        // lucide icon name
  tooltip: string;
  component: React.ComponentType<InputExtensionProps>;
}

interface InputExtensionProps {
  sessionId: string;
  disabled: boolean;
  inputText: string;
  onSetInputText: (text: string) => void;
  actions: ChatActions;
}
```

Example: file-attachment plugin adds a 📎 button. On click, opens a file picker; selected file is base64-encoded and injected into the message as an attachment. No core changes needed.

---

## Plugin-Owned SQLite

Each plugin gets its own isolated SQLite database:

```
~/.agemon/plugins/{pluginId}/state.db    ← ctx.db (read-write)
~/.agemon/agemon.db                      ← ctx.coreDb (read-only)
```

Plugins run their own migrations on first `onLoad`. Core has no knowledge of plugin schemas. Uninstalling a plugin removes its `state.db` cleanly.

**Why read-only on coreDb?**
Plugins should never write to the core schema directly. If a plugin needs to associate data with a session, it stores that in its own DB with a `session_id` foreign key. This prevents schema drift and makes plugin removal safe.

---

## Plugin Registration Queue (from pi-mono)

Inspired by pi-mono's extension registration queue pattern: registrations during `onLoad()` are queued, then flushed after all plugins have loaded.

This prevents ordering issues: plugin A's `onLoad` might call `ctx.hook('session:before_spawn', ...)` before plugin B has registered its WorkspaceProvider — but that's fine because the spawn event won't fire until after all plugins are loaded and the queue is flushed.

```ts
// Plugin host pseudo-code
for (const plugin of plugins) {
  await plugin.module.onLoad(createPluginContext(plugin.id));
}
// All plugins loaded — now flush registrations
registry.flush();
// Now sessions can be spawned, event bridge is fully wired
```

---

## Plugin Manifest (`agemon-plugin.json`)

```json
{
  "id": "git-workspace",
  "version": "1.0.0",
  "displayName": "Git Workspace",
  "description": "Git worktree isolation for sessions",
  "navLabel": null,
  "navIcon": null,
  "bundled": true,
  "skills": [],
  "dependencies": []
}
```

`navLabel` / `navIcon` non-null → plugin appears in the bottom nav. Plugins without nav items (workspace providers, renderers, cross-cutting) set these to null.

`bundled: true` → ships with agemon, always loaded. `bundled: false` → installable, opt-in.

`dependencies: ["tasks"]` → plugin host loads dependencies first.

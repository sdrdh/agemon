# Extension System Design

**Date:** 2026-03-25
**Status:** Approved
**Phase:** POC / pre-release

---

## Background

Agemon has a plugin system. This spec describes its redesign as an "extension system" — a rename plus several architectural improvements before any public release.

### Current state

- Plugins live in two places: repo-bundled at `backend/plugins/` and user-installed at `~/.agemon/plugins/`
- On startup, a single flat symlink is created: `~/.claude/plugins/agemon → ~/.agemon/plugins/`
- Each plugin's skills are symlinked individually into `~/.agemon/skills/{pluginId}--{skillName}`
- Plugin runtime data (`store.json`, `settings.json`) lives inside the plugin source directory at `~/.agemon/plugins/{id}/data/`, polluting the source tree and triggering file watchers
- No install/upgrade/remove mechanism — plugins are manually placed
- File watchers watch each plugin's `renderers/` directory individually plus the top-level `~/.agemon/plugins/` dir

### Key source files

- `backend/src/lib/plugins/loader.ts` — scan, load, skill wiring
- `backend/src/lib/plugins/builder.ts` — build pipeline, file watchers, hot reload
- `backend/src/lib/plugins/registry.ts` — in-memory plugin store
- `backend/src/lib/plugins/mount.ts` — dynamic route dispatch
- `backend/src/lib/plugins/types.ts` — PluginContext, PluginExports, etc.
- `backend/src/lib/agents.ts` — AgentPluginPath, AgentConfig per agent type
- `shared/types/plugin.ts` — PluginManifest (shared frontend/backend)

---

## Decisions Already Made

1. **Rename "plugins" → "extensions"** — `agemon-plugin.json` → `agemon-extension.json`, `~/.agemon/plugins/` → `~/.agemon/extensions/`, `backend/plugins/` → `backend/extensions/`, all internal types renamed
2. **Extensions bundle agent plugins** — manifest declares `agentPlugins` map, Agemon wires symlinks into each agent's discovery directory
3. **Data separation** — runtime data moves to `~/.agemon/extension-data/{id}/`; extension source dirs are code-only
4. **Flat directory + no registry file** — pure filesystem discovery, no `extensions.json`
5. **Managed symlink directory** — `~/.claude/plugins/agemon/` becomes a real directory with one symlink per extension
6. **Recursive file watcher** — single watcher on `~/.agemon/extensions/` replaces per-plugin watchers
7. **Install/upgrade/remove lifecycle** — REST API endpoints

---

## Manifest Schema (`agemon-extension.json`)

```jsonc
{
  // ── Identity ──────────────────────────────────────────────
  "id": "my-extension",           // unique slug, kebab-case
  "name": "My Extension",         // human-readable
  "version": "1.0.0",             // semver
  "description": "...",           // optional
  "apiVersion": 1,                // integer; loader warns on mismatch

  // ── Dependencies ─────────────────────────────────────────
  "depends": ["other-extension"], // load-order via topological sort; warn if dependency missing but still attempt load

  // ── Backend entrypoint ───────────────────────────────────
  "entryPoint": "index.ts",       // relative path; optional (manifest-only extensions OK)

  // ── Frontend: Nav & Pages ────────────────────────────────
  "navItems": [
    {
      "label": "My Extension",
      "lucideIcon": "Puzzle",
      "path": "/",               // relative to /p/{id}/
      "order": 50
    }
  ],
  "showInSettings": true,         // default true; false = headless

  // ── Frontend: Input extensions ───────────────────────────
  "inputExtensions": [
    {
      "id": "voice",
      "label": "Voice input",
      "lucideIcon": "Mic",
      "component": "voice-input"  // filename in renderers/ without .tsx
    }
  ],

  // ── Skills (agent-facing) ────────────────────────────────
  "skills": ["my-skill"],
  // subdirs in skills/ → ~/.agemon/skills/{id}--{name}/

  // ── Agent plugins ────────────────────────────────────────
  "agentPlugins": {
    "claude-code": "agent-plugins/claude-code/",
    "opencode":    "agent-plugins/opencode/"
  },
  // keys must be valid AgentType values; value = relative path from extension dir

  // ── Settings ─────────────────────────────────────────────
  "settings": [
    {
      "key": "api_key",
      "label": "API Key",
      "type": "secret",           // "string" | "secret" | "boolean" | "select"
      "options": [],              // required for type: "select"
      "required": true,
      "description": "..."
    }
  ],
  "settingsRenderer": "settings-ui", // optional: custom settings component name

  // ── Bookkeeping ───────────────────────────────────────────
  // "bundled" is NOT written in agemon-extension.json by extension authors.
  // The loader injects it at scan time based on which scan directory found the extension.
}
```

**`apiVersion` stays at 1** — this is a pre-release rename, not a breaking API change. Only bump when a shipped breaking change requires it.

**`settings` stays in the manifest JSON** — enables the frontend to render the settings form and compute `configured` state without loading extension JS. Settings remain accessible even if the extension fails to load.

---

## ExtensionContext / ExtensionExports API

### Renames (no shape changes)

| Old | New |
|-----|-----|
| `PluginContext` | `ExtensionContext` |
| `PluginExports` | `ExtensionExports` |
| `PluginModule` | `ExtensionModule` |
| `PluginStore` | `ExtensionStore` |
| `PluginLogger` | `ExtensionLogger` |
| `ctx.pluginDir` | `ctx.extensionDir` |
| `ctx.pluginDataDir` | `ctx.extensionDataDir` |

`extensionDataDir` now points to `~/.agemon/extension-data/{id}/` (separated from source).

### Shared WorkspaceRegistry

**Bug fix:** the current code creates a new `WorkspaceRegistry` instance per plugin. This means extensions cannot cross-query each other's workspace providers.

**Fix:** one shared `WorkspaceRegistry` instance created at server startup, passed into every `ExtensionContext`. Load order via topological sort on `depends` ensures workspace provider extensions register before consumer extensions run. A consumer extension that calls `ctx.workspaces.get('git-worktrees')` and gets `undefined` should handle it gracefully (provider not installed) rather than throwing.

**Rationale:** the workspace registry is a cross-cutting concern. The diff extension should work against whichever workspace provider is active (git worktrees, jj, cwd) by calling `ctx.workspaces.get('git-worktrees')` or iterating `ctx.workspaces.list()` — without declaring a hard dependency on a specific provider.

### No new context additions for agentPlugins

Agent plugin symlink wiring is handled entirely by the loader before `onLoad()` runs. Extensions do not need to call any API for this.

### ExtensionExports (unchanged beyond rename)

```typescript
interface ExtensionExports {
  apiRoutes?: Hono;
  pageRoutes?: Hono;
  renderers?: CustomRenderer[];
  pages?: ExtensionPage[];
  agentProviders?: AgentProvider[];
  queries?: Record<string, (...args: unknown[]) => unknown>;
  onUnload?(): void | Promise<void>;
}
```

---

## Agent Plugin Wiring

### Managed symlink directory

Replace the current flat symlink (`~/.claude/plugins/agemon → ~/.agemon/extensions/`) with a real managed directory containing one symlink per extension:

```
~/.claude/plugins/agemon/                          ← real directory
├── memory-cms → ~/.agemon/extensions/memory-cms/agent-plugins/claude-code/
├── git-worktrees → ~/.agemon/extensions/git-worktrees/agent-plugins/claude-code/
└── _bundled--tasks → {repoDir}/extensions/tasks/agent-plugins/claude-code/
```

The same pattern applies for each agent type that declares `pluginPaths` in `AGENT_CONFIGS`.

### Wiring algorithm

Runs at startup and after install/upgrade/remove:

1. For each extension with `agentPlugins` declared in manifest
2. For each `agentType` key in `agentPlugins`
3. Look up `AGENT_CONFIGS[agentType].pluginPaths`
4. For each `pluginPath` with a `globalDir`:
   - Ensure `{globalDir}/agemon/` is a real directory (create if needed)
   - If symlink at `{globalDir}/agemon/{extensionId}` already exists → remove and recreate (handles upgrade where `agentPlugins` map may have changed)
   - Create symlink `{globalDir}/agemon/{extensionId}` → `{extensionDir}/{agentPluginsSubdir}`
   - Skip with a warning if the target subdirectory doesn't exist in the extension (no broken symlinks)

### Agent type support

Agent types that currently declare no `pluginPaths` (opencode, gemini, pi) will silently skip `agentPlugins` entries targeting them. No error — agents gain plugin discovery support by adding `pluginPaths` to their `AgentConfig` when ready.

---

## Discovery: No Registry File

Pure filesystem discovery — no `extensions.json`.

**Startup:** scan all directories in `~/.agemon/extensions/` for `agemon-extension.json`. Valid manifests are loaded.

**Extension types** (three, detected at runtime, no registry needed):
- `bundled` — found in `{repoDir}/extensions/`; loader sets this flag
- `installed` — found in `~/.agemon/extensions/` and has a `.git/` directory
- `local` — found in `~/.agemon/extensions/` with no `.git/` directory (manually placed or agent-created)

**Upgrade gitUrl:** read from `{extensionDir}/.git/config` remote origin at upgrade time.

**Agentic creation:** an agent can create `~/.agemon/extensions/my-ext/` and populate it freely. The extension only becomes active when `agemon-extension.json` is written — this is the activation signal (see Draft Mode below).

### Scan priority

Scan order: `~/.agemon/extensions/` first, then `{repoDir}/extensions/`. First occurrence wins — installed/local extensions override bundled extensions with the same ID.

---

## Draft Mode

Extensions support an explicit draft → active lifecycle, enabling agents to build an extension across multiple steps without triggering premature hot-loads.

**Signal:** presence of `agemon-extension.json` is the activation signal.

| State | Condition | Watcher behaviour |
|-------|-----------|-------------------|
| Draft | `agemon-extension.json` absent; optionally `agemon-extension.draft.json` present | Ignored entirely |
| Active | `agemon-extension.json` present and valid | Loaded and watched for changes |

**Workflow:**
1. Agent creates `~/.agemon/extensions/my-ext/` and builds all files
2. Optionally writes `agemon-extension.draft.json` while iterating (ignored by watcher)
3. Renames to `agemon-extension.json` when ready → hot-load fires immediately
4. To return to draft: rename back to `agemon-extension.draft.json`

---

## File Watcher

Single recursive watcher on `~/.agemon/extensions/` replaces today's per-plugin individual watchers.

```typescript
watch('~/.agemon/extensions/', { recursive: true }, handler)
```

### Event routing

| Changed path pattern | Action | Debounce |
|---|---|---|
| `{id}/agemon-extension.json` (created) | Hot-load new extension | 500ms |
| `{id}/agemon-extension.json` (changed) | Reload manifest, re-wire | 500ms |
| `{id}/agemon-extension.json` (deleted) | Unload extension: call `onUnload()`, remove symlinks, remove from registry; directory remains on disk (reverted to draft) | 500ms |
| `{id}/renderers/**/*.{ts,tsx}` | Rebuild renderers for `{id}` | 300ms |
| `{id}/skills/**` | Re-wire skills for `{id}` | 500ms |
| `{id}/agent-plugins/**` | Re-wire agent plugin symlinks for `{id}` | 500ms |
| `{id}/.git/**` | **Ignore** | — |
| `{id}/node_modules/**` | **Ignore** | — |
| `{id}/dist/**` | **Ignore** (build output) | — |

Note: runtime data is now at `~/.agemon/extension-data/` (outside the extensions directory entirely), so no ignore rule is needed for it.

Bundled extensions (`{repoDir}/extensions/`) get a separate watcher with identical logic.

### Debounce strategy

- 300ms for renderer rebuilds (file saves settle quickly)
- 500ms for new directory / manifest changes (agent may write multiple files in quick succession)
- Concurrent rebuild guard: skip if a rebuild is already in progress for the same extension ID

---

## REST API

All endpoints require `Authorization: Bearer {AGEMON_KEY}`.

### `POST /api/extensions/install`

```
Request:  { "gitUrl": "https://github.com/example/my-ext" }
Response: { "id": "my-ext", "version": "1.0.0", "status": "loaded" }

Errors:
  409  { "error": "already_installed", "id": "my-ext" }
  422  { "error": "invalid_manifest", "details": "..." }
  500  { "error": "git_clone_failed", "details": "..." }
```

**ID resolution:** clone into a temp directory first, read `agemon-extension.json` to get `manifest.id`, then move to `~/.agemon/extensions/{id}/`. If the git repo name and `manifest.id` differ, `manifest.id` wins. If `manifest.id` collides with an already-loaded extension (bundled, installed, or local), return `409 already_installed`.

Runs full load cycle (install deps → build → scan → register → wire symlinks). Returns synchronously after load completes.

### `POST /api/extensions/:id/upgrade`

```
Response: { "id": "my-ext", "version": "1.1.0", "previousVersion": "1.0.0" }

Errors:
  404  { "error": "not_found" }
  409  { "error": "not_git_managed" }
  500  { "error": "git_pull_failed", "details": "..." }
```

Runs `git pull` in extension dir, then re-runs full load cycle.

### `DELETE /api/extensions/:id`

```
Response: { "id": "my-ext", "removed": true }

Errors:
  404  { "error": "not_found" }
  409  { "error": "bundled" }
```

Calls `onUnload()`, removes all agent discovery symlinks, removes extension directory.

### `GET /api/extensions`

Returns array of all loaded extensions:

```jsonc
[
  {
    "id": "memory-cms",
    "name": "Memory CMS",
    "version": "1.0.0",
    "type": "installed",    // "bundled" | "installed" | "local"
    "configured": true,
    "buildError": null
  }
]
```

### `GET /api/extensions/:id`

Same shape as a single item from the list above.

```
Errors:
  404  { "error": "not_found" }
```

---

## Migration Path

Automatic on first startup after upgrade. No user action required.

### Steps (run in order, each failure is logged and skipped — never blocks startup)

1. **Directory rename:** if `~/.agemon/plugins/` exists and `~/.agemon/extensions/` does not → rename `plugins/` to `extensions/`

2. **Data directory migration:** for each `~/.agemon/extensions/{id}/data/` that exists → move to `~/.agemon/extension-data/{id}/`. If `~/.agemon/extension-data/{id}/` already exists, merge: copy individual files that don't exist in the target, log a warning for any conflicts (file exists in both), leave conflicting files in the source location for manual resolution.

3. **Manifest rename:** for each extension dir, if `agemon-plugin.json` exists but `agemon-extension.json` does not → rename in place

4. **Symlink migration:** if `~/.claude/plugins/agemon` is a symlink (old flat approach) → remove symlink, create real directory, wire individual extension symlinks

5. **Repo dir rename:** `backend/plugins/` → `backend/extensions/` (code change at deploy time, not a runtime migration)

### Fallback

The loader accepts `agemon-plugin.json` as a fallback filename with a deprecation warning for one release cycle, then drops support.

---

## Directory Layout (After Migration)

```
~/.agemon/
├── extensions/
│   ├── memory-cms/             # installed (has .git/)
│   │   ├── agemon-extension.json
│   │   ├── index.ts
│   │   ├── renderers/
│   │   ├── skills/memory-recall/
│   │   └── agent-plugins/claude-code/
│   └── my-local-ext/           # local (no .git/)
│       ├── agemon-extension.draft.json   ← draft: not yet loaded
│       └── ...
├── extension-data/
│   ├── memory-cms/
│   │   ├── store.json
│   │   └── settings.json
│   └── my-local-ext/
├── skills/
│   └── memory-cms--memory-recall → ../extensions/memory-cms/skills/memory-recall/
└── ...

~/.claude/plugins/agemon/       ← real directory (not a symlink)
└── memory-cms → ~/.agemon/extensions/memory-cms/agent-plugins/claude-code/

{repoDir}/extensions/           ← bundled extensions (was backend/plugins/)
└── tasks/
    └── agemon-extension.json
```

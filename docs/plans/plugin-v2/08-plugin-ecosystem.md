# Plugin System v2 — Plugin Ecosystem

## Bundled (ship with agemon, always loaded)

These are non-optional. Removing them breaks core functionality.

| Plugin | Type | Notes |
|--------|------|-------|
| `git-workspace` | WorkspaceProvider | Default VCS workspace. Optional per-session — local-dir is baseline. |
| `claude-code` | AgentProvider | Default agent. |
| `tasks` | Feature (pages, renderers, skills, hooks) | Tasks, repos, dashboard, kanban, task detail. |
| `system` | Feature (version, update, settings UI) | `/p/system/settings`, update checker, restart. |
| `approval-renderer` | Renderer | Renders `approval_requested` events with approve/reject buttons. |
| `input-renderer` | Renderer | Renders `await_input` events as inline question blocks. |

---

## Optional (installable from registry or path)

### WorkspaceProviders

| Plugin | Notes |
|--------|-------|
| `jj-workspace` | Jujutsu workspaces. Faster remote-fetch, better conflict handling. Ships a change-graph frontend page. |
| `local-dir` | Explicit no-op provider — useful if you want workspace selection UI but no VCS isolation. Effectively the same as passing `meta.cwd` directly. |
| `docker-workspace` | Runs agent in a Docker container. Workspace = volume mount. Agent process runs locally, code in container. |
| `remote-ssh` | SSH into a remote machine. Agent runs locally via ACP stdio tunnel. |
| `devcontainer` | Uses `.devcontainer/devcontainer.json` to set up workspace. |

### AgentProviders

| Plugin | Notes |
|--------|-------|
| `opencode` | OpenCode CLI agent. |
| `gemini-cli` | Google Gemini CLI. |
| `pi` | pi-mono's `coding-agent`. |
| `codex` | OpenAI Codex CLI. |
| `aider` | Aider CLI agent. |

### Feature Plugins

| Plugin | Notes |
|--------|-------|
| `mcp-config` | MCP server configuration UI. Extracted from current `routes/mcp-config.ts`. |
| `skills-manager` | Skills CRUD UI. Extracted from current `routes/skills.ts`. |
| `memory-cms` | Memory file browser. Already exists as v1 plugin — needs adaptation to v2 contracts. |
| `diff-viewer` | Side-by-side diff renderer for `workspace:diff_ready` events. |

### InputExtensions

| Plugin | Notes |
|--------|-------|
| `file-attachment` | 📎 button — file picker, base64 encodes and attaches to message. |
| `voice-input` | 🎤 button — browser Web Speech API transcription. |
| `image-capture` | 📷 button — screenshot or camera capture. |

### Cross-cutting

| Plugin | Notes |
|--------|-------|
| `notifications` | Listens to `session:awaiting_input`, `session:ended`, etc. Sends push/Slack/email notifications. |
| `openclaw` | OpenClaw integration. Session events → OpenClaw webhooks. |
| `budget-guard` | Listens to token usage events. Stops session if budget exceeded. |
| `audit-log` | Writes all event bridge events to a structured log file. |

### Developer Tools

| Plugin | Notes |
|--------|-------|
| `plugin-builder` | In-app plugin studio. Monaco editor + manifest form + hot reload. EventBusViewer shows live bridge events. TemplateGallery scaffolds new plugins. |

---

## plugin-builder Studio

The meta-plugin for building plugins from within Agemon:

```
plugins/plugin-builder/
├── agemon-plugin.json    navLabel: "Studio"  navIcon: "wrench"
└── ui/
    ├── Studio.tsx           Monaco editor + manifest form + hot reload button
    ├── EventBusViewer.tsx   real-time stream of all event bridge events
    ├── TemplateGallery.tsx  scaffold: feature / renderer / input-ext / workspace / agent
    └── PluginLogs.tsx       stdout from onLoad() + runtime errors per plugin
```

**Studio flow:** pick template → files scaffold into `~/.agemon/plugins/{name}/` → edit in Monaco → Reload → plugin hot-swaps → frontend reflects new routes/renderers/nav items immediately.

**EventBusViewer** is the key development tool. Watch `session:state_changed`, `approval:requested`, `workspace:prepared` flow in real time to know exactly which hook to attach to. Filter by event name. Shows plugin ID of handler + execution time.

---

## jj-workspace Plugin (Detailed)

Worth expanding here because it addresses the main pain point with the current git-workspace: remote fetch on every session start.

```
plugins/jj-workspace/
├── agemon-plugin.json
└── index.ts

// Optional frontend page:
└── ui/
    └── ChangeGraph.tsx   jj log --graph rendered as interactive tree
```

**prepare():**
1. `jj workspace add ~/.agemon/sessions/{id}/{repo}`
2. Return `{ cwd: ~/.agemon/sessions/{id}/ }`

**cleanup():**
1. `jj workspace forget` + `rm -rf`

**getDiff():**
1. `jj diff` — no staging area, automatically tracks all working copy changes

**contextSections():**
```md
## VCS: Jujutsu
Use `jj` commands, not `git`:
- `jj new` instead of `git checkout -b`
- `jj describe` instead of `git commit -m`
- `jj diff` / `jj status`
- `jj git push` to push to remote
No staging area — jj tracks all working copy changes automatically.
```

**Requirement:** checks for `jj` binary at plugin load, warns if absent (doesn't crash server). Works in colocated mode (`jj git init --colocate`) — repo stays valid git for `gh pr create`.

**ChangeGraph page (`/p/jj-workspace/:sessionId/graph`):**
- Parses `jj log --template` output
- Shows change IDs, descriptions, authors
- Highlights current working change
- Click a change → shows diff inline
- "Create PR from change" button

---

## Plugin Discovery & Installation (future)

Not in scope for v2 initial implementation, but worth designing for:

1. **Local path** — `agemon plugin install ./my-plugin/` — copies to `~/.agemon/plugins/`
2. **npm** — `agemon plugin install npm:@agemon/diff-viewer` — uses jiti-style dynamic import
3. **Registry** — `agemon plugin install diff-viewer` — looks up in official registry
4. **Git** — `agemon plugin install git:https://github.com/user/plugin` — clones + builds

Plugin removal: `agemon plugin remove diff-viewer` — deletes `~/.agemon/plugins/diff-viewer/` and its `state.db`.

Server auto-detects new plugin directories at startup and via `watchPluginsDir` (hot load without restart).

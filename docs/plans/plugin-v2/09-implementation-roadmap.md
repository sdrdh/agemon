# Plugin System v2 — Implementation Roadmap

## Guiding Principles

- Every step leaves the system in a working state. No big-bang cutovers.
- Steps 0–3 are pure backend refactoring with no user-visible change. Ship each as its own PR.
- Steps 4–5 have UI impact — use feature flags, verify parity before cutting over.
- Steps 6+ are the payoff.
- Single binary / Bun compile is a Phase 7 (Build & Distribution) concern — do not let it drive architecture decisions now.

---

## Current State (as of 2026-03-21)

Already implemented on `feat/plugin-system-v2`:
- ✅ EventBridge with hooks/listeners
- ✅ WorkspaceProvider interface + default git implementation
- ✅ AgentProvider interface + AgentRegistry
- ✅ JSONL events per-session + meta.json + checkpoint logic
- ✅ DB migrations v17–v18 (meta_json on sessions, nullable task_id)
- ✅ **Step 0** — Filesystem storage (`133e684`): sessions → session.json, settings → settings.json, in-memory SQLite projection
- ✅ **Step 1** — ctx.createSession/spawnSession + fixed startup order (`6f0dbce`): setBridge before plugins, plugins before recoverInterruptedSessions
- ✅ **Step 2** — cwd WorkspaceProvider + task workspace config (`004fc5d`): WorkspaceRegistry, cwd + git-worktree built-in providers, workspace_json on tasks, frontend workspace picker
- ✅ **Step 3** — Tasks plugin extraction (`2ec174a`): task CRUD moved to plugin HTTP routes, session creation via ctx.createSession/spawnSession. **Note:** plugin routes called core DB directly (not true filesystem ownership — see deferred decisions below)
- ✅ **Step 4** — Tasks plugin UI pages: page.tsx (Dashboard/Kanban/TaskDetail/NewTask), onWsEvent on window.__AGEMON__, SPA fallback in getPluginPage
- ✅ **Step 5** — Frontend plugin infrastructure (dynamic nav): PluginNavItem + navItems[], BottomNav fully plugin-driven, SessionList shared component with taskId filter, raw session creation

Not yet implemented:
- ❌ Import maps (Step 5 partial — still using window.__AGEMON__ globals, see deferred decisions)
- ❌ Ecosystem plugins

---

## Deferred Decisions

### Tasks plugin is UI-only (core owns task data)

**What happened:** Step 3 added plugin HTTP routes that proxied task CRUD to the core DB. This created a duplicate API layer (`/api/plugins/tasks/*` and `/api/tasks/*` calling the same functions). Step 5 resolved this by making the tasks plugin **UI-only**: `plugins/tasks/index.ts` has no `apiRoutes`, and `page.tsx` calls `/api/tasks` directly.

**What was deferred:** Moving `task-store.ts` and `routes/tasks.ts` out of core and into the plugin. Tasks are already JSON on disk at `~/.agemon/tasks/{id}.json` (Step 3 delivered this). The remaining work is code ownership — those modules living in `backend/src/` rather than `plugins/tasks/`.

**To complete the vision:** requires the ACP event refactor (see below) so `deriveTaskStatus` doesn't need to be imported by the plugin, and a clean data migration path.

### ACP event refactor deferred

**What happened:** `deriveTaskStatus` is called directly in 6 places across `handshake.ts`, `lifecycle.ts`, `prompt.ts`, `resume.ts`. The tasks plugin's `session:state_changed` hook also calls it — so both paths run. This is safe (idempotent) but not clean.

**What was deferred:** Replacing the 6 direct `deriveTaskStatus` calls with `bridge.emit('session:state_changed', ...)` so the core ACP layer has zero task knowledge and the plugin hook is the sole trigger.

**Current state:** Plugin registers `ctx.on('session:state_changed', ...)` → calls `deriveTaskStatus`. Core also calls it directly. Redundant but harmless.

**TODO marker:** `plugins/tasks/index.ts` has an inline TODO comment.

### Import maps deferred

`window.__AGEMON__` globals still used for React/Lucide shared between host and plugins. Browser import maps (Step 5 original plan) deferred to avoid Vite config complexity. Works fine for now.


---

## Step 0: Filesystem Storage ✅ (`133e684`)

**What:** Replace persistent `agemon.db` SQLite with filesystem JSON files + in-memory SQLite projection. This is the foundational change that everything else builds on. Do it first so we don't have to redo it after task extraction.

**See:** `10-filesystem-storage.md` for full design.

**Tasks:**
- Create `backend/src/lib/fs.ts` with `atomicWrite()` / `atomicWriteJson()` utilities
- Create `backend/src/lib/store.ts` with `buildInMemoryDb()` — scans `sessions/` dir, populates in-memory SQLite
- Replace `db/sessions.ts` writes with filesystem writes + in-memory updates
- Replace `db/settings.ts` reads/writes with `settings.json`
- Replace persistent `db/client.ts` SQLite connection with in-memory SQLite
- One-time migration: copy existing `agemon.db` sessions/settings to filesystem layout
- Update `PluginContext`: replace `ctx.coreDb` (persistent SQLite handle) with in-memory SQLite (read-only)
- Add `ctx.atomicWrite()` utility and `ctx.pluginDataDir` to PluginContext
- Keep `acp_events` SQLite table as read-only legacy fallback (new sessions use JSONL)
- Delete `db/migrations.ts`, `db/schema.sql`, `db/tasks.ts`, `db/approvals.ts`

**Acceptance criteria:**
- Server starts fresh with no `agemon.db`, creates `sessions/` + `settings.json` on demand
- Existing sessions survive restart (rebuilt from `sessions/*/session.json`)
- All existing API endpoints return correct data

**No user-visible change.**

---

## Step 1: PluginContext Session API + Bootstrap Order ✅ (`6f0dbce`)

**What:** Give plugins a clean API for creating sessions. Fix startup order so plugins are always loaded before sessions are resumed.

**Tasks:**
- Add to `PluginContext`:
  ```ts
  createSession(opts: { agentType: string; meta: object }): Promise<Session>;
  spawnSession(sessionId: string): Promise<void>;
  ```
- Fix `server.ts` startup order:
  ```
  1. Core in-memory DB init (scan sessions/ dir)
  2. Plugin loader — all plugins load, WorkspaceProviders + AgentProviders register
  3. resumeInterruptedSessions() — providers now available
  ```
- Update existing `plugins/tasks/index.ts` to use `ctx.createSession()` instead of writing to sessions table directly
- Update AgentRegistry comments: spawn-time only, no mid-session switching

**No user-visible change.**

---

## Step 2: cwd WorkspaceProvider + task Workspace Config ✅ (this commit)

**What:** Make workspace a first-class concept at task creation. Add cwd as a built-in workspace type. Embed workspace config in task.json instead of a separate `task_repos` table.

**Tasks:**
- Register built-in `cwd` WorkspaceProvider at server startup (not a plugin):
  ```ts
  const cwdProvider: WorkspaceProvider = {
    async prepare(session) {
      const cwd = session.meta.cwd as string;
      if (!cwd || !(await exists(cwd))) throw new Error(`cwd not found: ${cwd}`);
      return { cwd };
    }
  };
  ```
- Update `POST /api/tasks` to accept `workspace: { provider: string; config: object }` instead of `repos[]`
- Embed workspace in task.json: `{ ..., workspace: { provider: "git-worktree", config: { repos: [...] } } }`
- Update `startSession` in tasks plugin:
  1. Read workspace from task.json
  2. Call `ctx.createSession({ agentType, meta: { task_id, workspaceProvider: ws.provider, ...ws.config } })`
- `PluginExports.workspaceFormFields` — providers declare their creation UI fields
- Update task creation UI: add workspace picker step (cwd path input or repo selector)
- Migrate existing tasks: `task_repos` rows → embedded workspace config in task.json

**User-visible: task creation form gains a workspace step.**

---

## Step 3: Tasks Plugin Extraction ✅ (`2ec174a`)

**What:** Move task CRUD into the plugin. Plugin creates sessions via `ctx.createSession/spawnSession`.

**Implemented:**
- Plugin HTTP routes at `/api/plugins/tasks/*` for full task CRUD + session creation
- Session creation uses `ctx.createSession/spawnSession` (not `spawnAndHandshake` directly)
- Plugin registers `session:state_changed` hook → `deriveTaskStatus`

**Not completed as originally designed:**
- Tasks filesystem storage (`~/.agemon/plugins/tasks/tasks/{id}.json`) — deferred. Core `db/client.ts` + `routes/tasks.ts` still owns task data.
- Feature-flag cutover — not needed given the UI-only decision in Step 5.

**See Deferred Decisions above.**

---

## Step 4: Tasks Plugin UI Pages ✅

**What:** Build React pages for the tasks plugin. Cut over frontend routes.

**Implemented:**
- `plugins/tasks/renderers/page.tsx` — SPA with internal router: Dashboard, Kanban, TaskDetail, NewTask (with workspace picker)
- `window.__AGEMON__.onWsEvent` for live task_updated events
- SPA fallback in `getPluginPage` so all `/p/tasks/*` sub-paths serve the root component
- TaskDetail links to `/sessions?taskId=` (core SessionList) rather than embedding a session list

**Nav:** Plugin manifest uses `navItems: [{ label: "Tasks", lucideIcon: "CheckSquare", path: "/", order: 0 }]`. Kanban accessible in-plugin via Dashboard header button — not a separate nav item.

---

## Step 5: Frontend Plugin Infrastructure ✅ (partial)

**What:** Nav becomes fully plugin-driven. Plugin pages get interactive capabilities.

**Implemented:**
- `PluginNavItem` + `navItems[]` in `PluginManifest` (replaces single `navLabel/navLucideIcon/navOrder`)
- `/api/plugins` synthesizes `navItems` from legacy fields for backward compatibility
- `BottomNav` flattens all plugin `navItems`, sorts globally by `order`
- `pluginsRevision` WS store triggers nav refetch on `plugins_changed`
- `resolveLucideIcon` fixed for lucide-react v0.4xx (forwardRef objects, not functions)
- `SessionList` shared component with `taskId?` filter + raw session creation form
- `sessions` route gains `validateSearch` for `?taskId=`
- Hardcoded nav: `Home → /` (activity dashboard), `Sessions`, `Settings` — plugin items sorted between Home and Sessions

**Not implemented (deferred):**
- Import maps — still using `window.__AGEMON__` globals (works, lower priority)
- `ChatActions` interface, `inputExtensions` slot, `PluginErrorBoundary` — not needed yet
- "Plugin not found" 404 page

---

## Step 6: Extract Remaining Plugins

Independent, ship in any order:

- **git-workspace plugin** — extract `lib/git.ts` + `lib/context.ts` git parts into a WorkspaceProvider plugin
  - Filesystem: `~/.agemon/repos/` (already there, just moves ownership)
- **mcp-config plugin** — `routes/mcp-config.ts` → plugin + page at `/p/mcp-config/`
  - Filesystem: `~/.agemon/plugins/mcp-config/servers/{id}.json`
- **skills-manager plugin** — `routes/skills.ts` → plugin + page at `/p/skills/`
- **system plugin** — version, updater → plugin + settings at `/p/system/settings`
  - Other plugins contribute `settingsSection` exports

After Step 6: `backend/src/routes/` has only `sessions.ts`. Core is ~3,000 lines.

---

## Step 7: Ecosystem Plugins

Build once foundation is solid:

1. **jj-workspace** — Jujutsu WorkspaceProvider alternative
2. **opencode + gemini-cli** — AgentProvider plugins
3. **plugin-builder** — Studio + EventBusViewer (Agemon dogfooding itself)
4. **notifications** — cross-cutting event bridge listener
5. **diff-viewer** — Renderer + page
6. **file-attachment** — InputExtension

---

## Sequencing Rationale

```
Step 0 (Filesystem)  ──→  Step 1 (Session API + Boot Order)  ──→  Step 2 (Workspaces)
                                          │
                                          ↓
                                 Step 3 (Tasks Extraction)
                                          │
                                          ↓
                                 Step 4 (Tasks UI)
                                          │
                                          ↓
                                 Step 5 (Frontend Infra)
                                          │
                                          ↓
                                 Step 6 (Other Plugins)  ──→  Step 7 (Ecosystem)
```

**Do not skip Step 0.** Deferring filesystem migration means redoing it inside the tasks plugin extraction (Step 3) anyway.

Steps 0–2 are pure backend, no user impact, low risk. Steps 3–4 are highest risk (existing data, existing UI). Steps 5–7 are additive.

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| Filesystem migration corrupts existing data | Migration backs up `agemon.db` → `agemon.db.migrated`; fallback reads from backup |
| Startup rebuild slow with many sessions | `session.json` reads are fast (< 1ms each); < 10k sessions = < 50ms total |
| atomicWrite race condition | Not possible — Bun is single-threaded; `rename()` is atomic at OS level |
| Tasks extraction breaks existing workflows | Feature-flag strategy; parity testing before cutover |
| Plugin hook ordering causes subtle bugs | Priority numbers on hooks; documented hook catalogue |
| Plugin UI load latency on mobile | Lazy fetch only on navigation; skeleton UI while loading |

---

## Definition of Done for v2

- [x] No persistent `agemon.db` — sessions in `~/.agemon/sessions/`, tasks in `~/.agemon/tasks/`, settings in `settings.json`
- [ ] Core imports zero domain modules (no git, no tasks, no agent-specific config) — **task-store.ts + git still in core**
- [x] Raw session (no workspace plugin, just `meta.cwd`) starts and runs
- [ ] Tasks, mcp-config, skills-manager, system all live as plugins — **task routes + store still in core; plugin is UI-only**
- [ ] Frontend has 3 hardcoded routes; all domain routes served by plugins — **tasks routes still core**
- [x] JSONL events for all new sessions; `acp_events` table unused (new sessions)
- [x] Tasks are agent-readable: `cat ~/.agemon/tasks/{id}.json` — ✅ already JSON on filesystem (path differs from original plan)
- [ ] `plugin-builder` EventBusViewer shows live event stream

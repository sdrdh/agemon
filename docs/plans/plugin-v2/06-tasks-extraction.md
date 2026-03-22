# Plugin System v2 — Tasks Extraction

## Overview

The tasks plugin is the reference implementation of a rich multi-capability plugin. It demonstrates: feature routes, plugin pages, renderers, skills, queries, and event bridge hooks all in one plugin.

It is also the **biggest extraction** — the most lines, the most user-visible change, the highest risk.

---

## Session / Task Decoupling

The key architectural move: replace `agent_sessions.task_id FK` with `meta_json TEXT`.

```sql
-- Current
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),   -- ← FK
  ...
);

-- After
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  meta_json TEXT DEFAULT '{}',         -- ← "task_id" lives here if tasks plugin is loaded
  ...
);
```

When the tasks plugin creates a session, it writes `{ "task_id": "..." }` into `meta_json`. The tasks plugin owns the task→session mapping in its own `task_sessions` table. Core has zero knowledge of what a task is.

This means sessions can exist without the tasks plugin — raw ACP sessions, useful for testing, scripting, or other organizational models.

---

## Tasks Plugin Owns Its Own Filesystem Namespace

Tasks live at `~/.agemon/plugins/tasks/tasks/{id}.json`. No SQLite file. Core has zero schema knowledge of tasks, repos, or workspaces.

```
~/.agemon/plugins/tasks/
└── tasks/
    └── {id}.json    ← full task data, workspace config embedded
```

`task.json` shape:
```json
{
  "id": "abc123",
  "title": "Add dark mode",
  "description": "...",
  "status": "working",
  "createdAt": "2026-03-20T10:00:00Z",
  "workspace": {
    "provider": "git-worktree",
    "config": { "repos": ["sdrdh/agemon"] }
  }
}
```

`task_repos` is gone. Workspace config is embedded directly in `task.json`. One file, complete picture, agent-readable.

On plugin load, `onLoad()` scans `tasks/*.json` → populates `ctx.db` (in-memory SQLite) for querying. All writes: `atomicWrite(taskFile, ...)` then `ctx.db.run('UPDATE tasks ...')`.

Task-to-session mapping derived on load: scan `ctx.coreDb` sessions, extract `meta.task_id` → populate `task_sessions` in `ctx.db`.

The tasks plugin reads `ctx.coreDb` **read-only** (session states for status derivation). It never writes to core data directly — session creation goes through `ctx.createSession()` (see API Routes below).

---

## Plugin Structure

```
plugins/tasks/
├── agemon-plugin.json
├── index.ts              apiRoutes, pages, renderers, skills, queries, hooks
├── skills/
│   ├── create-task.md
│   ├── list-tasks.md
│   └── mark-done.md
└── ui/
    ├── Dashboard.tsx         page: /p/tasks/
    ├── Kanban.tsx            page: /p/tasks/kanban
    ├── TaskDetail.tsx        page: /p/tasks/:id
    ├── NewTask.tsx           page: /p/tasks/new
    ├── ActiveSession.tsx     page: /p/tasks/sessions (session list filtered by task)
    ├── TaskStatusBubble.tsx  renderer: "task_status"
    └── TaskCreatedBubble.tsx renderer: "task_created"
```

---

## Task Status Derivation via Event Bridge

Currently `acp/lifecycle.ts` hardcodes task status derivation. After extraction, this moves entirely into the tasks plugin:

```ts
// In tasks plugin onLoad:
ctx.on('session:state_changed', async ({ sessionId, to }) => {
  const taskId = await getTaskForSession(ctx.db, sessionId);
  if (!taskId) return;
  await deriveAndUpdateTaskStatus(ctx.db, taskId);
  ctx.broadcast({ type: 'task_status_changed', taskId, status: derivedStatus });
});

ctx.on('session:awaiting_input', async ({ sessionId }) => {
  const taskId = await getTaskForSession(ctx.db, sessionId);
  if (!taskId) return;
  await setTaskStatus(ctx.db, taskId, 'awaiting_input');
  ctx.broadcast({ type: 'task_status_changed', taskId, status: 'awaiting_input' });
});
```

No core changes needed. The tasks plugin reads from `ctx.coreDb` (sessions state) and writes to its own `ctx.db` (tasks state).

---

## API Routes

The tasks plugin registers all `/api/tasks/*` routes:

```ts
export function onLoad(ctx: PluginContext): PluginExports {
  return {
    apiRoutes(app) {
      app.get('/api/tasks', listTasks(ctx));
      app.post('/api/tasks', createTask(ctx));
      app.get('/api/tasks/:id', getTask(ctx));
      app.patch('/api/tasks/:id', updateTask(ctx));
      app.delete('/api/tasks/:id', deleteTask(ctx));
      app.post('/api/tasks/:id/sessions', startSession(ctx));  // creates session in core + writes meta
      // ...repos, task_repos, etc.
    },
  };
}
```

`startSession` in the tasks plugin:
1. Reads the task's `task_workspaces` row to get `provider_id` + `config_json`
2. Calls `ctx.createSession({ agentType, meta: { task_id, workspaceProvider: provider_id, ...config_json } })`
3. Core creates the session row, fires `session:before_spawn` hook chain (workspace prep, context generation)
4. Tasks plugin records `task_sessions (task_id, session_id)` on the `session:created` event

Plugin never touches the `sessions` table directly. Session state machine stays entirely in core.

```ts
// PluginContext session API:
interface PluginContext {
  createSession(opts: { agentType: string; meta: object }): Promise<Session>;
  spawnSession(sessionId: string): Promise<void>;
}
```

---

## Frontend Routes

| Current route | Migrates to | Served by |
|---------------|-------------|-----------|
| `/` (dashboard) | `/p/tasks/` | tasks plugin page |
| `/kanban` | `/p/tasks/kanban` | tasks plugin page |
| `/tasks/:id` | `/p/tasks/:id` | tasks plugin page |
| `/tasks/new` | `/p/tasks/new` | tasks plugin page |
| `/projects` | `/p/tasks/projects` | tasks plugin page |
| `/sessions` | `/p/tasks/sessions` | tasks plugin page |

The core frontend has no routes for these. The bottom nav `Home` button points to `/p/tasks/` if the tasks plugin is loaded, or `/sessions/:last` otherwise (raw session list as fallback).

---

## Queries

The tasks plugin exposes typed queries that other plugins (and the frontend) can call without going through REST:

```ts
queries: {
  getTask: async (taskId: string) => ctx.db.query('SELECT * FROM tasks WHERE id = ?').get(taskId),
  listTasksForSession: async (sessionId: string) => { ... },
  getTaskStatus: async (taskId: string) => { ... },
}
```

Frontend uses these via a generic `/api/plugins/tasks/query/:name` endpoint (registered by the plugin host).

---

## Bootstrap Order (Important)

With tasks table in `tasks.db` and workspace config in tasks plugin, the server startup order must be explicit:

```
1. Core DB initialises (sessions, settings)
2. Plugin loader scans + loads all plugins (tasks, git-workspace, etc.)
   → WorkspaceProviders register themselves
   → AgentProviders register themselves
3. Core resumes interrupted sessions
   → reads meta_json.workspaceProvider from session row
   → calls workspaceRegistry.get(provider).prepare(session)
   → WorkspaceProvider is available because step 2 completed first
```

Step 3 cannot run before step 2. This is a hard dependency. The plugin loader must fully resolve before `resumeInterruptedSessions()` is called in `server.ts`.

---

## Dashboard Cross-DB Queries

The dashboard needs "running sessions + their task names" — a join across `ctx.coreDb` (sessions, in-memory) and `ctx.db` (tasks, in-memory). Both are in-memory SQLite so this is trivial application-level code, no file I/O at query time.

Solution: tasks plugin exposes a synchronous JS function via `PluginExports.queries`:

```ts
queries: {
  getTasksBySessionIds: (sessionIds: string[]) => Task[]
}
```

The dashboard route (owned by the tasks plugin) reads sessions from `coreDb` read-only, then bulk-fetches task data from its own DB. No N+1, no HTTP round-trip.

---

## Migration Strategy

This is the highest-risk extraction. Recommended approach:

1. **Keep current routes live** during extraction (`/api/tasks`, `/tasks/:id` frontend route).
2. **Build tasks plugin** alongside — new routes at `/api/plugins/tasks/*`, new pages at `/p/tasks/*`.
3. **Feature flag in frontend**: `TASKS_PLUGIN=true` env toggles between old routes and plugin routes.
4. **Verify parity** — all existing task features work via plugin.
5. **Cut over**: old routes return 301 to new routes, then remove.
6. **Remove old code**.

Never a big-bang cutover. Users should never see breakage.

---

## Open Questions

1. **Multi-repo sessions**: `task_repos` is replaced by `task_workspaces.config_json.repos` for git-worktree tasks. Core has no concept of repos. The git-workspace plugin reads the repos list from `meta_json` at spawn time and creates one worktree per repo.

2. **Task creation from agent**: the tasks plugin ships `create-task.md` skill. When an agent calls it, it emits a `task:created` event. Does the tasks plugin auto-start a session for the new task? Probably not by default (respect "task status is system-controlled" principle) — but could be configurable.

3. **Dashboard as default route**: if tasks plugin is not installed (stripped-down Agemon deployment), what does `/` show? Options: raw session list, a plugin-picker, or an empty shell. Recommendation: `/` redirects to `/sessions` which is always core.

# Repo-Grouped Tasks, Task Creation UI, and ACP Agent Connection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add relational repo model with server-side project grouping, mobile-first task creation/detail UI, and Claude agent process lifecycle via ACP.

**Architecture:** New `repos` + `task_repos` join tables replace the JSON `repos` column on `tasks`. Backend gains `GET /api/tasks/by-project`, `GET /api/repos`, `POST /api/tasks/:id/start`, `POST /api/tasks/:id/stop`. Frontend gets three new routes: project list (`/`), task creation (`/tasks/new`), task detail (`/tasks/:id`). Agent spawning is managed by `backend/src/lib/acp.ts` using `Bun.spawn`.

**Tech Stack:** Bun 1.1+ (runtime + SQLite + test runner), Hono 4.x (REST), React 18, TanStack Router/Query, shadcn/ui, Tailwind CSS.

**Design doc:** `docs/plans/2026-03-02-repo-grouped-tasks-acp-design.md`

---

## Task 1: Schema Migration — repos + task_repos tables

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/client.ts` (bump SCHEMA_VERSION to 3, add migration logic)

**Step 1: Update schema.sql**

Add the `repos` and `task_repos` tables at the end of schema.sql. Do NOT drop the `tasks.repos` JSON column yet — the migration in client.ts will handle data extraction first.

```sql
-- Repository registry
CREATE TABLE IF NOT EXISTS repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Many-to-many: tasks <-> repos
CREATE TABLE IF NOT EXISTS task_repos (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_task_repos_repo ON task_repos(repo_id);
```

**Step 2: Add migration logic in client.ts**

In `runMigrations()`, after the existing schema version check, add a v3 migration block. This migration:
1. Runs the updated schema.sql (creates new tables via IF NOT EXISTS)
2. Extracts existing JSON repos from tasks into the new tables
3. Drops the `repos` column by recreating the tasks table without it

The migration must be wrapped in a transaction. Key code for the data extraction:

```typescript
// Inside the v3 migration transaction:

// 1. Extract repos from existing tasks JSON column
const existingTasks = db.query<{ id: string; repos: string }, []>(
  'SELECT id, repos FROM tasks'
).all();

for (const task of existingTasks) {
  const repos: string[] = JSON.parse(task.repos);
  for (const url of repos) {
    const name = parseRepoName(url);
    db.run(
      'INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)',
      [url, name]
    );
    const repo = db.query<{ id: number }, [string]>(
      'SELECT id FROM repos WHERE url = ?'
    ).get(url);
    if (repo) {
      db.run(
        'INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)',
        [task.id, repo.id]
      );
    }
  }
}

// 2. Recreate tasks table without repos column
db.run(`CREATE TABLE tasks_new (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) <= 500),
  description TEXT CHECK (description IS NULL OR length(description) <= 10000),
  status      TEXT NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
  agent       TEXT NOT NULL DEFAULT 'claude-code'
                CHECK (agent IN ('claude-code', 'opencode', 'aider', 'gemini')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`);
db.run(`INSERT INTO tasks_new (id, title, description, status, agent, created_at)
        SELECT id, title, description, status, agent, created_at FROM tasks`);
db.run('DROP TABLE tasks');
db.run('ALTER TABLE tasks_new RENAME TO tasks');
```

Add `parseRepoName` as a module-level helper:

```typescript
/** Extract display name from repo URL. git@github.com:acme/web.git → acme/web */
function parseRepoName(url: string): string {
  // SSH: git@github.com:org/repo.git
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // HTTPS: https://github.com/org/repo
  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return url;
}
```

Export `parseRepoName` — it'll be needed by route handlers too.

**Step 3: Verify migration**

Run: `cd backend && AGEMON_KEY=test bun run src/server.ts`

Expected: Console shows `[db] migrated to schema version 3`. Server starts without errors.

Verify with sqlite3:
```bash
sqlite3 agemon.db ".schema repos" ".schema task_repos" ".schema tasks"
```
Expected: `repos` and `task_repos` tables exist. `tasks` table has no `repos` column.

**Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/client.ts
git commit -m "feat: add repos + task_repos tables, migrate from JSON column (schema v3)"
```

---

## Task 2: Update Shared Types

**Files:**
- Modify: `shared/types/index.ts`

**Step 1: Add Repo type and update Task interface**

Add after the `AgentSessionState` type:

```typescript
export interface Repo {
  id: number;
  url: string;
  name: string;
  created_at: string;
}
```

Update the `Task` interface — change `repos: string[]` to `repos: Repo[]`:

```typescript
export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  repos: Repo[];
  agent: AgentType;
  created_at: string;
}
```

**Step 2: Update API payloads**

Update `CreateTaskBody` — make repos optional, they're SSH URL strings (not Repo objects):

```typescript
export interface CreateTaskBody {
  title: string;
  description?: string;
  repos?: string[];  // SSH URLs; optional, default []
  agent?: AgentType; // default claude-code
}
```

Update `UpdateTaskBody` — add repos:

```typescript
export interface UpdateTaskBody {
  title?: string;
  description?: string;
  repos?: string[];  // SSH URLs; replaces full set
  agent?: AgentType;
}
```

**Step 3: Add TasksByProject response type**

```typescript
export interface TasksByProject {
  projects: Record<string, Task[]>;  // keyed by repo name (e.g. "acme/web")
  ungrouped: Task[];
}
```

**Step 4: Verify types compile**

Run: `cd frontend && bunx tsc --noEmit`

Expected: Type errors in `backend/src/db/client.ts` and `backend/src/routes/tasks.ts` (expected — they still reference the old Task shape). No errors in shared/.

**Step 5: Commit**

```bash
git add shared/types/index.ts
git commit -m "feat: add Repo type, update Task.repos to Repo[], make CreateTaskBody.repos optional"
```

---

## Task 3: Backend DB Helpers — Repo CRUD + Updated Task Queries

**Files:**
- Modify: `backend/src/db/client.ts`

**Step 1: Add repo query helpers**

Add to the `db` object, before the Tasks section:

```typescript
// ── Repos ──

listRepos(): Repo[] {
  const db = getDb();
  return db.query<Repo, []>('SELECT * FROM repos ORDER BY name').all();
},

getRepo(id: number): Repo | null {
  const db = getDb();
  return db.query<Repo, [number]>('SELECT * FROM repos WHERE id = ?').get(id) ?? null;
},

getRepoByUrl(url: string): Repo | null {
  const db = getDb();
  return db.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url) ?? null;
},

upsertRepo(url: string): Repo {
  const database = getDb();
  const name = parseRepoName(url);
  database.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [url, name]);
  const row = database.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url);
  if (!row) throw new Error(`[db] failed to upsert repo with url ${url}`);
  return row;
},
```

**Step 2: Add task_repos helpers**

```typescript
// ── Task-Repos ──

getTaskRepos(taskId: string): Repo[] {
  const db = getDb();
  return db.query<Repo, [string]>(
    `SELECT r.* FROM repos r
     JOIN task_repos tr ON tr.repo_id = r.id
     WHERE tr.task_id = ?
     ORDER BY r.name`
  ).all(taskId);
},

setTaskRepos(taskId: string, repoUrls: string[]): Repo[] {
  const database = getDb();
  database.run('DELETE FROM task_repos WHERE task_id = ?', [taskId]);
  const repos: Repo[] = [];
  for (const url of repoUrls) {
    const repo = this.upsertRepo(url);
    database.run(
      'INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)',
      [taskId, repo.id]
    );
    repos.push(repo);
  }
  return repos;
},
```

**Step 3: Update task query helpers**

Update `RawTask` — remove `repos` field:

```typescript
interface RawTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  agent: string;
  created_at: string;
}
```

Update `parseTask` — no longer parse JSON repos. Instead, repos will be attached separately:

```typescript
function parseTask(row: RawTask): Omit<Task, 'repos'> {
  const status = TASK_STATUSES.has(row.status as Task['status'])
    ? (row.status as Task['status'])
    : (() => { throw new Error(`[db] unexpected task status: ${row.status}`); })();
  const agent = AGENT_TYPES_SET.has(row.agent as AgentType)
    ? (row.agent as AgentType)
    : (() => { throw new Error(`[db] unexpected agent type: ${row.agent}`); })();
  return { ...row, status, agent };
}
```

Update `listTasks()` to attach repos:

```typescript
listTasks(): Task[] {
  const database = getDb();
  const rows = database.query<RawTask, []>('SELECT * FROM tasks ORDER BY created_at DESC').all();
  return rows.map(row => ({
    ...parseTask(row),
    repos: this.getTaskRepos(row.id),
  }));
},
```

Update `getTask()`:

```typescript
getTask(id: string): Task | null {
  const database = getDb();
  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return { ...parseTask(row), repos: this.getTaskRepos(id) };
},
```

Update `createTask()` — no longer stores repos in tasks table:

```typescript
createTask(task: { id: string; title: string; description: string | null; status: TaskStatus; agent: AgentType; repos?: string[] }): Task {
  const database = getDb();
  database.run(
    'INSERT INTO tasks (id, title, description, status, agent) VALUES (?, ?, ?, ?, ?)',
    [task.id, task.title, task.description ?? null, task.status, task.agent]
  );
  const repos = task.repos ? this.setTaskRepos(task.id, task.repos) : [];
  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(task.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted task with id ${task.id}`);
  return { ...parseTask(row), repos };
},
```

Update `updateTask()` — handle repos separately:

```typescript
updateTask(id: string, fields: { title?: string; description?: string | null; status?: TaskStatus; agent?: AgentType; repos?: string[] }): Task | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
  if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
  if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
  if (fields.agent !== undefined) { sets.push('agent = ?'); values.push(fields.agent); }

  const database = getDb();

  if (sets.length > 0) {
    values.push(id);
    database.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  if (fields.repos !== undefined) {
    this.setTaskRepos(id, fields.repos);
  }

  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return { ...parseTask(row), repos: this.getTaskRepos(id) };
},
```

**Step 4: Add listTasksByProject()**

```typescript
listTasksByProject(): TasksByProject {
  const database = getDb();

  // Tasks with repos — one row per task-repo pair
  interface TaskRepoRow extends RawTask {
    repo_url: string;
    repo_name: string;
  }
  const taskRepoRows = database.query<TaskRepoRow, []>(`
    SELECT t.*, r.url as repo_url, r.name as repo_name
    FROM tasks t
    JOIN task_repos tr ON tr.task_id = t.id
    JOIN repos r ON r.id = tr.repo_id
    ORDER BY r.name, t.created_at DESC
  `).all();

  // Tasks without any repos
  const ungroupedRows = database.query<RawTask, []>(`
    SELECT t.* FROM tasks t
    WHERE t.id NOT IN (SELECT task_id FROM task_repos)
    ORDER BY t.created_at DESC
  `).all();

  // Collect all unique task IDs to batch-fetch repos
  const taskIds = new Set<string>();
  for (const row of taskRepoRows) taskIds.add(row.id);
  for (const row of ungroupedRows) taskIds.add(row.id);

  // Cache repos per task
  const repoCache = new Map<string, Repo[]>();
  for (const taskId of taskIds) {
    repoCache.set(taskId, this.getTaskRepos(taskId));
  }

  // Build projects map
  const projects: Record<string, Task[]> = {};
  const seenPerProject = new Map<string, Set<string>>(); // repo_name -> Set<task_id>

  for (const row of taskRepoRows) {
    const repoName = row.repo_name;
    if (!projects[repoName]) {
      projects[repoName] = [];
      seenPerProject.set(repoName, new Set());
    }
    const seen = seenPerProject.get(repoName)!;
    if (!seen.has(row.id)) {
      seen.add(row.id);
      projects[repoName].push({
        ...parseTask(row),
        repos: repoCache.get(row.id) ?? [],
      });
    }
  }

  const ungrouped: Task[] = ungroupedRows.map(row => ({
    ...parseTask(row),
    repos: [],
  }));

  return { projects, ungrouped };
},
```

**Step 5: Add import for TasksByProject**

At the top of client.ts, update the import:

```typescript
import type { Task, ACPEvent, AwaitingInput, Diff, AgentSession, AgentSessionState, AgentType, Repo, TasksByProject } from '@agemon/shared';
```

**Step 6: Verify compilation**

Run: `cd backend && bunx tsc --noEmit`

Expected: Errors only in `routes/tasks.ts` (it still references old `repos` field in CreateTaskBody handling). No errors in client.ts.

**Step 7: Commit**

```bash
git add backend/src/db/client.ts
git commit -m "feat: add repo CRUD helpers, update task queries for join-table model"
```

---

## Task 4: Backend Routes — Updated Endpoints

**Files:**
- Modify: `backend/src/routes/tasks.ts`

**Step 1: Update repo validation**

Replace the `isValidRepoUrl` function with SSH-only validation:

```typescript
const SSH_REPO_REGEX = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/;

function isValidSshRepoUrl(url: string): boolean {
  return SSH_REPO_REGEX.test(url);
}
```

**Step 2: Update POST /tasks**

The key changes: repos is optional (defaults to []), agent is optional (defaults to 'claude-code'), validation uses SSH regex.

```typescript
tasksRoutes.post('/tasks', async (c) => {
  let body: CreateTaskBody;
  try {
    body = await c.req.json<CreateTaskBody>();
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }
  const { title: rawTitle, description, repos, agent } = body;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : rawTitle;

  if (!title || typeof title !== 'string') {
    sendError(400, 'title is required');
  }

  const repoUrls = repos ?? [];
  if (!Array.isArray(repoUrls)) {
    sendError(400, 'repos must be an array');
  }
  if (repoUrls.length > 20) {
    sendError(400, 'repos must contain 20 or fewer entries');
  }
  if (!repoUrls.every(r => typeof r === 'string' && isValidSshRepoUrl(r))) {
    sendError(400, 'each repo must be a valid SSH URL (git@host:org/repo.git)');
  }
  if (!repoUrls.every(r => r.length <= 500)) {
    sendError(400, 'each repo URL must be 500 characters or fewer');
  }

  const agentType = agent ?? 'claude-code';
  validateTaskFields({ title, description, agent: agentType });

  const task = db.createTask({
    id: randomUUID(),
    title,
    description: description ?? null,
    status: 'todo',
    agent: agentType,
    repos: repoUrls,
  });

  broadcast({ type: 'task_updated', task });
  return c.json(task, 201);
});
```

**Step 3: Update PATCH /tasks/:id**

Add repos support:

```typescript
tasksRoutes.patch('/tasks/:id', async (c) => {
  const task = requireTask(c.req.param('id'));

  let body: UpdateTaskBody;
  try {
    body = await c.req.json<UpdateTaskBody>();
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }

  const { title, description, agent, repos } = body;
  validateTaskFields({ title, description, agent });

  if (repos !== undefined) {
    if (!Array.isArray(repos)) {
      sendError(400, 'repos must be an array');
    }
    if (repos.length > 20) {
      sendError(400, 'repos must contain 20 or fewer entries');
    }
    if (!repos.every(r => typeof r === 'string' && isValidSshRepoUrl(r))) {
      sendError(400, 'each repo must be a valid SSH URL (git@host:org/repo.git)');
    }
    if (!repos.every(r => r.length <= 500)) {
      sendError(400, 'each repo URL must be 500 characters or fewer');
    }
  }

  const updated = db.updateTask(task.id, { title, description, agent, repos });
  if (!updated) return c.json({ error: 'Not Found', message: 'Task not found', statusCode: 404 }, 404);
  broadcast({ type: 'task_updated', task: updated });
  return c.json(updated);
});
```

**Step 4: Add GET /tasks/by-project**

```typescript
tasksRoutes.get('/tasks/by-project', (c) => {
  return c.json(db.listTasksByProject());
});
```

**Step 5: Add GET /repos**

```typescript
tasksRoutes.get('/repos', (c) => {
  return c.json(db.listRepos());
});
```

**Step 6: Add POST /tasks/:id/start and POST /tasks/:id/stop**

These are stubs for now — they validate and call `acp.ts` (implemented in Task 5). For now, add the route handlers that validate inputs and return placeholder responses:

```typescript
tasksRoutes.post('/tasks/:id/start', (c) => {
  const task = requireTask(c.req.param('id'));
  if (task.status !== 'todo') {
    sendError(400, 'Task must be in todo status to start');
  }
  // TODO: integrate with acp.ts in Task 5
  sendError(501, 'Agent spawning not yet implemented');
});

tasksRoutes.post('/tasks/:id/stop', (c) => {
  const task = requireTask(c.req.param('id'));
  if (task.status !== 'working') {
    sendError(400, 'Task must be in working status to stop');
  }
  // TODO: integrate with acp.ts in Task 5
  sendError(501, 'Agent stopping not yet implemented');
});
```

**Step 7: Update imports**

Update the import at the top of tasks.ts:

```typescript
import type { CreateTaskBody, UpdateTaskBody, AgentType, Task } from '@agemon/shared';
```

(Same as before — no new types needed in routes.)

**Step 8: Verify the server starts and endpoints work**

Delete the existing `agemon.db` file (schema changed), then start the server:

```bash
cd backend && rm -f agemon.db && AGEMON_KEY=test bun run src/server.ts
```

Test with curl:

```bash
# Create task with no repos
curl -s -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task"}' | jq .

# Create task with repos
curl -s -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"title":"Multi-repo task","repos":["git@github.com:acme/web.git","git@github.com:acme/api.git"]}' | jq .

# List repos
curl -s http://localhost:3000/api/repos -H "Authorization: Bearer test" | jq .

# Get by project
curl -s http://localhost:3000/api/tasks/by-project -H "Authorization: Bearer test" | jq .
```

Expected: Tasks created with repos array of Repo objects. `/repos` returns the two repos. `/tasks/by-project` returns the multi-repo task under both `acme/web` and `acme/api`.

**Step 9: Commit**

```bash
git add backend/src/routes/tasks.ts
git commit -m "feat: add by-project grouping, repos endpoint, SSH-only validation, start/stop stubs"
```

---

## Task 5: Backend ACP Manager

**Files:**
- Create: `backend/src/lib/acp.ts`
- Modify: `backend/src/routes/tasks.ts` (wire start/stop to acp.ts)
- Modify: `backend/src/server.ts` (shutdown handler + crash recovery)

**Step 1: Create backend/src/lib/acp.ts**

```typescript
import { db } from '../db/client.ts';
import { broadcast, eventBus } from '../server.ts';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentType } from '@agemon/shared';

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  sessionId: string;
}

// In-memory map: sessionId → running process info
const sessions = new Map<string, RunningSession>();

const KILL_TIMEOUT_MS = 5_000;

function checkBinary(): string {
  const path = Bun.which('claude-agent-acp');
  if (!path) {
    throw new Error('claude-agent-acp not found on PATH. Install it from https://github.com/zed-industries/claude-agent-acp');
  }
  return path;
}

export function spawnAgent(taskId: string, agentType: AgentType): AgentSession {
  const binaryPath = checkBinary();
  const sessionId = randomUUID();

  // Insert session row
  const session = db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  // Spawn the process
  const proc = Bun.spawn([binaryPath, '--agent', agentType], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  // Update PID
  db.updateSessionState(sessionId, 'starting', { pid: proc.pid });

  sessions.set(sessionId, { proc, sessionId });

  // Async: read stdout for session ID and ACP events
  readStdout(proc, sessionId, taskId);

  // Async: handle process exit
  handleExit(proc, sessionId, taskId);

  return session;
}

async function readStdout(
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
  taskId: string
) {
  if (!proc.stdout) return;

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let hasExternalId = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          // First JSON message: extract session/connection ID
          if (!hasExternalId && event.session_id) {
            db.updateSessionState(sessionId, 'running', {
              external_session_id: event.session_id,
            });
            hasExternalId = true;
            broadcast({
              type: 'session_started',
              taskId,
              session: db.getSession(sessionId)!,
            });
            // Update task status to working
            db.updateTask(taskId, { status: 'working' });
            const task = db.getTask(taskId);
            if (task) broadcast({ type: 'task_updated', task });
            continue;
          }

          // If we haven't seen external_id yet but got a message, move to running anyway
          if (!hasExternalId) {
            db.updateSessionState(sessionId, 'running');
            hasExternalId = true;
            broadcast({
              type: 'session_started',
              taskId,
              session: db.getSession(sessionId)!,
            });
            db.updateTask(taskId, { status: 'working' });
            const task = db.getTask(taskId);
            if (task) broadcast({ type: 'task_updated', task });
          }

          // Store ACP event
          const eventType = event.type;
          if (eventType === 'thought' || eventType === 'action' || eventType === 'await_input' || eventType === 'result') {
            db.insertEvent({
              id: randomUUID(),
              task_id: taskId,
              session_id: sessionId,
              type: eventType,
              content: line,
            });

            if (eventType === 'await_input') {
              db.insertAwaitingInput({
                id: randomUUID(),
                task_id: taskId,
                session_id: sessionId,
                question: event.content ?? event.message ?? line,
              });
              db.updateTask(taskId, { status: 'awaiting_input' });
              const task = db.getTask(taskId);
              if (task) broadcast({ type: 'task_updated', task });
              broadcast({
                type: 'awaiting_input',
                taskId,
                question: event.content ?? event.message ?? line,
                inputId: '', // filled by the insertAwaitingInput call
              });
            } else {
              broadcast({
                type: 'agent_thought',
                taskId,
                content: event.content ?? line,
              });
            }
          }
        } catch {
          // Non-JSON line — log as raw thought
          if (hasExternalId) {
            db.insertEvent({
              id: randomUUID(),
              task_id: taskId,
              session_id: sessionId,
              type: 'thought',
              content: line,
            });
            broadcast({ type: 'agent_thought', taskId, content: line });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[acp] stdout read error for session ${sessionId}:`, err);
  }
}

async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
  taskId: string
) {
  const exitCode = await proc.exited;
  const state = exitCode === 0 ? 'stopped' : 'crashed';

  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, state });

  // Check if task has any other running sessions
  const runningSessions = db.listSessions(taskId).filter(s => s.state === 'running' || s.state === 'starting');
  if (runningSessions.length === 0) {
    // No more running sessions — update task based on exit state
    if (state === 'stopped') {
      db.updateTask(taskId, { status: 'done' });
    } else {
      db.updateTask(taskId, { status: 'todo' });
    }
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });
  }

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
}

export function stopAgent(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }

  entry.proc.kill('SIGTERM');

  // Force kill after timeout
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      console.warn(`[acp] session ${sessionId} did not exit after SIGTERM, sending SIGKILL`);
      entry.proc.kill('SIGKILL');
    }
  }, KILL_TIMEOUT_MS);
}

export function getRunningSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find(s => s.state === 'running' || s.state === 'starting') ?? null;
}

/** Mark any sessions left in starting/running as interrupted (crash recovery on startup). */
export function recoverInterruptedSessions(): void {
  const startingSessions = db.listSessionsByState('starting');
  const runningSessions = db.listSessionsByState('running');

  for (const session of [...startingSessions, ...runningSessions]) {
    db.updateSessionState(session.id, 'interrupted', { pid: null });
    console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
  }
}

/** Gracefully stop all running sessions (server shutdown). */
export async function shutdownAllSessions(): Promise<void> {
  const promises: Promise<number>[] = [];
  for (const [sessionId, entry] of sessions) {
    console.info(`[acp] shutting down session ${sessionId}`);
    entry.proc.kill('SIGTERM');
    promises.push(entry.proc.exited);
  }
  if (promises.length > 0) {
    await Promise.race([
      Promise.all(promises),
      new Promise(resolve => setTimeout(resolve, KILL_TIMEOUT_MS)),
    ]);
    // Force-kill any remaining
    for (const [, entry] of sessions) {
      entry.proc.kill('SIGKILL');
    }
  }
}
```

**Step 2: Wire start/stop routes in tasks.ts**

Replace the placeholder start/stop handlers:

```typescript
import { spawnAgent, stopAgent, getRunningSession } from '../lib/acp.ts';

// ...

tasksRoutes.post('/tasks/:id/start', (c) => {
  const task = requireTask(c.req.param('id'));
  if (task.status !== 'todo') {
    sendError(400, 'Task must be in todo status to start');
  }
  try {
    const session = spawnAgent(task.id, task.agent);
    return c.json(session, 202);
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

tasksRoutes.post('/tasks/:id/stop', (c) => {
  const task = requireTask(c.req.param('id'));
  const session = getRunningSession(task.id);
  if (!session) {
    sendError(404, 'No running session found for this task');
  }
  try {
    stopAgent(session!.id);
    return c.json({ message: 'Stop signal sent', sessionId: session!.id });
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});
```

**Step 3: Add crash recovery and shutdown to server.ts**

At the end of server.ts, after `Bun.serve(...)`:

```typescript
import { recoverInterruptedSessions, shutdownAllSessions } from './lib/acp.ts';

// Crash recovery: mark stale sessions as interrupted
recoverInterruptedSessions();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});
```

Note: The import of `recoverInterruptedSessions` and `shutdownAllSessions` must be placed carefully to avoid circular imports. Since `acp.ts` imports from `server.ts` (for `broadcast` and `eventBus`), the import in `server.ts` must be dynamic or placed after the exports. Use a dynamic import:

```typescript
// At the end of server.ts, after Bun.serve():
const { recoverInterruptedSessions, shutdownAllSessions } = await import('./lib/acp.ts');
recoverInterruptedSessions();

process.on('SIGINT', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});
```

**Step 4: Verify compilation**

Run: `cd backend && bunx tsc --noEmit`

Expected: No type errors.

**Step 5: Commit**

```bash
git add backend/src/lib/acp.ts backend/src/routes/tasks.ts backend/src/server.ts
git commit -m "feat: add ACP agent manager with spawn/stop/recovery lifecycle"
```

---

## Task 6: Frontend API Client Updates

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Update imports and add new API methods**

```typescript
import type { Task, CreateTaskBody, UpdateTaskBody, Repo, TasksByProject, AgentSession } from '@agemon/shared';
```

Add to the `api` object:

```typescript
export const api = {
  listTasks: () => request<Task[]>('/tasks'),
  listTasksByProject: () => request<TasksByProject>('/tasks/by-project'),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (body: CreateTaskBody) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: UpdateTaskBody) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  listRepos: () => request<Repo[]>('/repos'),
  startTask: (id: string) => request<AgentSession>(`/tasks/${id}/start`, { method: 'POST' }),
  stopTask: (id: string) => request<{ message: string; sessionId: string }>(`/tasks/${id}/stop`, { method: 'POST' }),
};
```

**Step 2: Verify compilation**

Run: `cd frontend && bunx tsc --noEmit`

Expected: No type errors (may still have unused import warnings — those are fine).

**Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add listTasksByProject, listRepos, startTask, stopTask to API client"
```

---

## Task 7: Frontend Components — StatusBadge, TaskCard, RepoSelector, AgentSelector

**Files:**
- Create: `frontend/src/components/custom/status-badge.tsx`
- Create: `frontend/src/components/custom/task-card.tsx`
- Create: `frontend/src/components/custom/repo-selector.tsx`
- Create: `frontend/src/components/custom/agent-selector.tsx`

**Step 1: Create StatusBadge**

```typescript
import type { TaskStatus } from '@agemon/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  working: 'Working',
  awaiting_input: 'Awaiting Input',
  done: 'Done',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={status}>{STATUS_LABELS[status]}</Badge>;
}
```

**Step 2: Create TaskCard**

```typescript
import type { Task } from '@agemon/shared';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from './status-badge';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <Card
      className="cursor-pointer active:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{task.title}</CardTitle>
          <StatusBadge status={task.status} />
        </div>
        <CardDescription className="flex items-center gap-2 mt-1">
          <span>{task.agent}</span>
          {task.repos.length > 1 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {task.repos.length} repos
            </span>
          )}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
```

**Step 3: Create RepoSelector**

This component shows checkboxes for existing repos from the registry plus an inline input to add new SSH URLs.

```typescript
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Repo } from '@agemon/shared';

interface RepoSelectorProps {
  selected: string[]; // SSH URLs
  onChange: (urls: string[]) => void;
}

const SSH_REPO_REGEX = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/;

export function RepoSelector({ selected, onChange }: RepoSelectorProps) {
  const [registryRepos, setRegistryRepos] = useState<Repo[]>([]);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listRepos().then(setRegistryRepos).catch(() => {});
  }, []);

  const selectedSet = new Set(selected);

  function toggleRepo(url: string) {
    if (selectedSet.has(url)) {
      onChange(selected.filter(u => u !== url));
    } else {
      onChange([...selected, url]);
    }
  }

  function addNewRepo() {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (!SSH_REPO_REGEX.test(trimmed)) {
      setError('Must be SSH format: git@host:org/repo.git');
      return;
    }
    if (selectedSet.has(trimmed)) {
      setError('Already selected');
      return;
    }
    onChange([...selected, trimmed]);
    setNewUrl('');
    setError('');
    setShowAddInput(false);
  }

  // Combine registry repos with any selected URLs not in registry
  const registryUrls = new Set(registryRepos.map(r => r.url));
  const extraSelected = selected.filter(url => !registryUrls.has(url));

  return (
    <div className="space-y-2">
      <Label>Repositories</Label>

      {registryRepos.map(repo => (
        <label
          key={repo.id}
          className="flex items-center gap-3 min-h-[44px] px-2 rounded-md hover:bg-accent cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selectedSet.has(repo.url)}
            onChange={() => toggleRepo(repo.url)}
            className="h-5 w-5 rounded border-input"
          />
          <span className="text-sm">{repo.name}</span>
        </label>
      ))}

      {extraSelected.map(url => (
        <div key={url} className="flex items-center gap-3 min-h-[44px] px-2">
          <input
            type="checkbox"
            checked
            onChange={() => toggleRepo(url)}
            className="h-5 w-5 rounded border-input"
          />
          <span className="text-sm font-mono">{url}</span>
        </div>
      ))}

      {showAddInput ? (
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            <Input
              value={newUrl}
              onChange={e => { setNewUrl(e.target.value); setError(''); }}
              placeholder="git@github.com:org/repo.git"
              onKeyDown={e => e.key === 'Enter' && addNewRepo()}
              className="h-11 font-mono text-sm"
            />
            <Button size="icon" variant="ghost" onClick={() => { setShowAddInput(false); setNewUrl(''); setError(''); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button variant="secondary" onClick={addNewRepo} className="w-full">
            Add
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setShowAddInput(true)}
        >
          <Plus className="h-4 w-4" />
          Add repository
        </Button>
      )}
    </div>
  );
}
```

**Step 4: Create AgentSelector**

```typescript
import { AGENT_TYPES } from '@agemon/shared';
import type { AgentType } from '@agemon/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>Agent</Label>
      <Select value={value} onValueChange={v => onChange(v as AgentType)}>
        <SelectTrigger className="h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_TYPES.map(agent => (
            <SelectItem key={agent} value={agent} className="min-h-[44px]">
              {agent}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/custom/
git commit -m "feat: add StatusBadge, TaskCard, RepoSelector, AgentSelector components"
```

---

## Task 8: Frontend Routes — ProjectListView, TaskCreateForm, TaskDetailView

**Files:**
- Rewrite: `frontend/src/routes/index.tsx` (ProjectListView)
- Create: `frontend/src/routes/tasks.new.tsx` (TaskCreateForm)
- Create: `frontend/src/routes/tasks.$id.tsx` (TaskDetailView)
- Modify: `frontend/src/App.tsx` (add new routes to router)

**Step 1: Rewrite routes/index.tsx as ProjectListView**

```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/components/custom/task-card';
import { api } from '@/lib/api';
import type { TasksByProject } from '@agemon/shared';

export default function ProjectListView() {
  const [data, setData] = useState<TasksByProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listTasksByProject()
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-10 w-1/3 rounded-md bg-muted animate-pulse" />
        <div className="h-24 rounded-md bg-muted animate-pulse" />
        <div className="h-24 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{error}</p>
        <Button variant="link" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const projectNames = Object.keys(data?.projects ?? {}).sort();
  const hasUngrouped = (data?.ungrouped ?? []).length > 0;

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agemon</h1>
        <Button size="icon" onClick={() => navigate({ to: '/tasks/new' })}>
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {projectNames.length === 0 && !hasUngrouped && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tasks yet.</p>
            <Button variant="link" onClick={() => navigate({ to: '/tasks/new' })}>
              Create your first task
            </Button>
          </div>
        )}

        {projectNames.map(name => (
          <section key={name}>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">{name}</h2>
            <div className="space-y-2">
              {data!.projects[name].map(task => (
                <TaskCard
                  key={`${name}-${task.id}`}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        ))}

        {hasUngrouped && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">No repository</h2>
            <div className="space-y-2">
              {data!.ungrouped.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create routes/tasks.new.tsx**

```typescript
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RepoSelector } from '@/components/custom/repo-selector';
import { AgentSelector } from '@/components/custom/agent-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import type { AgentType } from '@agemon/shared';

export default function TaskCreateForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [agent, setAgent] = useState<AgentType>('claude-code');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      const task = await api.createTask({
        title: trimmedTitle,
        description: description.trim() || undefined,
        repos: repos.length > 0 ? repos : undefined,
        agent,
      });
      navigate({ to: '/tasks/$id', params: { id: task.id } });
    } catch (err) {
      showToast({ title: 'Failed to create task', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">New Task</h1>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="h-11"
            maxLength={500}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Additional context for the agent..."
            rows={3}
            maxLength={10000}
          />
        </div>

        <RepoSelector selected={repos} onChange={setRepos} />

        <AgentSelector value={agent} onChange={setAgent} />

        <Button type="submit" className="w-full" disabled={!title.trim() || submitting}>
          {submitting ? 'Creating...' : 'Create Task'}
        </Button>
      </form>
    </div>
  );
}
```

**Step 3: Create routes/tasks.$id.tsx**

```typescript
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { RepoSelector } from '@/components/custom/repo-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import type { Task } from '@agemon/shared';

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getTask(id)
      .then(setTask)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRepoChange(urls: string[]) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { repos: urls });
      setTask(updated);
    } catch (err) {
      showToast({ title: 'Failed to update repos', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleStart() {
    if (!task) return;
    setActionLoading(true);
    try {
      await api.startTask(task.id);
      const updated = await api.getTask(task.id);
      setTask(updated);
      showToast({ title: 'Agent started' });
    } catch (err) {
      showToast({ title: 'Failed to start agent', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    if (!task) return;
    setActionLoading(true);
    try {
      await api.stopTask(task.id);
      const updated = await api.getTask(task.id);
      setTask(updated);
      showToast({ title: 'Stop signal sent' });
    } catch (err) {
      showToast({ title: 'Failed to stop agent', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
        <div className="h-20 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{error || 'Task not found'}</p>
        <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
      </div>
    );
  }

  const isRunning = task.status === 'working' || task.status === 'awaiting_input';

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Status + Agent */}
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <span className="text-sm text-muted-foreground">{task.agent}</span>
        </div>

        {/* Description */}
        {task.description && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1">Description</h2>
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        {/* Repos */}
        <RepoSelector
          selected={task.repos.map(r => r.url)}
          onChange={handleRepoChange}
        />

        {/* Agent controls */}
        <div>
          {task.status === 'todo' && (
            <Button
              className="w-full gap-2"
              onClick={handleStart}
              disabled={actionLoading}
            >
              <Play className="h-4 w-4" />
              {actionLoading ? 'Starting...' : 'Start Agent'}
            </Button>
          )}
          {isRunning && (
            <Button
              className="w-full gap-2"
              variant="destructive"
              onClick={handleStop}
              disabled={actionLoading}
            >
              <Square className="h-4 w-4" />
              {actionLoading ? 'Stopping...' : 'Stop Agent'}
            </Button>
          )}
          {task.status === 'done' && (
            <p className="text-center text-sm text-muted-foreground">Task completed</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Update App.tsx — add new routes**

Add lazy imports:

```typescript
const TaskCreatePage = lazy(() => import('./routes/tasks.new'));
const TaskDetailPage = lazy(() => import('./routes/tasks.$id'));
```

Add route definitions:

```typescript
const taskNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/new',
  component: TaskCreatePage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/$id',
  component: TaskDetailPage,
});
```

Update the route tree:

```typescript
const routeTree = rootRoute.addChildren([indexRoute, taskNewRoute, taskDetailRoute]);
```

**Step 5: Verify frontend compiles and renders**

Run: `cd frontend && bunx tsc --noEmit && bun run dev`

Expected: No type errors. Open http://localhost:5173 and verify:
- Project list loads (empty state if no tasks)
- "+" button navigates to /tasks/new
- Form renders with all fields
- Back button works

**Step 6: Commit**

```bash
git add frontend/src/routes/ frontend/src/App.tsx
git commit -m "feat: add ProjectListView, TaskCreateForm, TaskDetailView routes"
```

---

## Task 9: Update Seed Data

**Files:**
- Modify: `backend/src/db/seed.ts`

**Step 1: Update seed to use new schema (no JSON repos column)**

The seed script must create repos via the new `db.upsertRepo()` and `db.setTaskRepos()` helpers instead of passing `repos` in `createTask`:

```typescript
import { randomUUID } from 'crypto';
import { runMigrations, db } from './client.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to run seed in production');
  process.exit(1);
}

runMigrations();

const taskId1 = randomUUID();
const taskId2 = randomUUID();
const taskId3 = randomUUID();

// Sample tasks (repos set separately via setTaskRepos)
db.createTask({
  id: taskId1,
  title: 'Add JWT authentication to backend + frontend',
  description: 'Implement JWT-based auth across the API and React app.',
  status: 'todo',
  agent: 'claude-code',
  repos: ['git@github.com:example/backend.git', 'git@github.com:example/frontend.git'],
});

db.createTask({
  id: taskId2,
  title: 'Refactor database query layer',
  description: 'Extract raw SQL into typed query functions. Add indexes for performance.',
  status: 'working',
  agent: 'claude-code',
  repos: ['git@github.com:example/backend.git'],
});

db.createTask({
  id: taskId3,
  title: 'Write mobile layout tests',
  description: 'Add Playwright tests for mobile viewport on key user flows.',
  status: 'done',
  agent: 'aider',
  repos: ['git@github.com:example/frontend.git'],
});

// Agent session for the working task
const sessionId2 = randomUUID();
db.insertSession({
  id: sessionId2,
  task_id: taskId2,
  agent_type: 'claude-code',
  pid: null,
});
db.updateSessionState(sessionId2, 'running');

// Sample ACP events
db.insertEvent({ id: randomUUID(), task_id: taskId2, session_id: sessionId2, type: 'thought', content: 'Looking at the existing query patterns in the codebase...' });
db.insertEvent({ id: randomUUID(), task_id: taskId2, session_id: sessionId2, type: 'action', content: 'Reading backend/src/db/client.ts' });

// Completed session for the done task
const sessionId3 = randomUUID();
db.insertSession({
  id: sessionId3,
  task_id: taskId3,
  agent_type: 'aider',
  pid: null,
});
db.updateSessionState(sessionId3, 'stopped', { exit_code: 0 });

console.log('[seed] sample data inserted');
```

**Step 2: Verify seed**

```bash
cd backend && rm -f agemon.db && AGEMON_KEY=test bun run src/db/seed.ts
```

Expected: `[db] migrated to schema version 3` then `[seed] sample data inserted`.

Verify:
```bash
sqlite3 agemon.db "SELECT r.name, t.title FROM task_repos tr JOIN repos r ON r.id = tr.repo_id JOIN tasks t ON t.id = tr.task_id"
```

Expected: Shows task-repo links (e.g., `example/backend|Add JWT auth...`).

**Step 3: Commit**

```bash
git add backend/src/db/seed.ts
git commit -m "feat: update seed data for relational repo model"
```

---

## Task 10: End-to-End Verification

**Step 1: Clean slate test**

```bash
cd backend && rm -f agemon.db && AGEMON_KEY=test bun run src/db/seed.ts && AGEMON_KEY=test bun run src/server.ts
```

In another terminal:
```bash
cd frontend && bun run dev
```

**Step 2: Verify each flow**

1. Open http://localhost:5173, enter API key "test"
2. Project list should show tasks grouped by `example/backend` and `example/frontend`
3. Task "Add JWT auth..." should appear under both groups with "2 repos" badge
4. Tap "+" → full-page form loads
5. Create a task with no repos → appears in "No repository" section
6. Create a task with a new SSH repo → repo appears in registry
7. Tap a task → detail view with repos, status, start button
8. Edit repos on detail view → saves correctly

**Step 3: Final commit**

If all checks pass, no additional commit needed. If fixes were required, commit them.

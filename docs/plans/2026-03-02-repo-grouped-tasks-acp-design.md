# Design: Repo-Grouped Tasks, Task Creation UI, and ACP Agent Connection

**Date:** 2026-03-02
**Tasks:** 1.3 (REST API), 2.3 (Task Creation UI), 4.1 (Claude Agent Connection)

---

## Summary

Three features implemented together: a relational repo model with server-side project grouping, a mobile-first task creation and detail UI, and a Claude agent process manager via ACP.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Project grouping | Server-side via JOIN | Frontend stays dumb; SQLite handles it efficiently |
| Repo storage | Join table (repos + task_repos) | Proper relational model; drop JSON column |
| Repo source | Registry derived from usage | First time free-text, then autocomplete from registry |
| Repo format | SSH URLs only | `git@github.com:org/repo.git`; display name derived as `org/repo` |
| Repos on task | Optional, editable after creation | Can create tasks with no repos; add/remove later |
| Add Task UI | Full-page form (`/tasks/new`) | More room than bottom sheet; avoids keyboard overlap on mobile |
| ACP binary | Require pre-installed on PATH | Fail with clear error if missing; document in getting-started |
| Worktrees | Deferred to Task 3.1 | Task 4.1 is purely ACP process lifecycle |

---

## Schema Changes

### New tables

```sql
CREATE TABLE repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_repos (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, repo_id)
);

CREATE INDEX idx_task_repos_repo ON task_repos(repo_id);
```

### Migration

1. Create `repos` and `task_repos` tables.
2. Extract existing JSON `repos` data from `tasks` into the new tables.
3. Drop the `repos` column from `tasks`.

The `name` field is derived on insert by parsing the SSH URL: `git@github.com:acme/web.git` becomes `acme/web`.

---

## Backend API

### Updated endpoints

**`GET /api/tasks`** — returns tasks with repos populated via LEFT JOIN:

```sql
SELECT t.*, GROUP_CONCAT(r.url) as repo_urls, GROUP_CONCAT(r.name) as repo_names
FROM tasks t
LEFT JOIN task_repos tr ON tr.task_id = t.id
LEFT JOIN repos r ON r.id = tr.repo_id
GROUP BY t.id
ORDER BY t.created_at DESC
```

**`POST /api/tasks`** — repos is optional array of SSH URLs:

```json
{ "title": "Fix auth", "repos": ["git@github.com:acme/web.git"], "agent": "claude-code" }
```

For each URL: upsert into `repos` (derive name), then insert into `task_repos`.

**`PATCH /api/tasks/:id`** — repos replaces the full set:

```json
{ "repos": ["git@github.com:acme/web.git", "git@github.com:acme/api.git"] }
```

Delete existing `task_repos` rows for this task, upsert new repos, insert new links.

### New endpoints

**`GET /api/tasks/by-project`** — server-side repo grouping:

```sql
-- Tasks with repos
SELECT t.*, r.url as repo_url, r.name as repo_name
FROM tasks t
JOIN task_repos tr ON tr.task_id = t.id
JOIN repos r ON r.id = tr.repo_id

UNION ALL

-- Tasks without repos
SELECT t.*, NULL, NULL
FROM tasks t
WHERE t.id NOT IN (SELECT task_id FROM task_repos)

ORDER BY repo_name, created_at DESC
```

Response shape:

```json
{
  "projects": {
    "acme/web": [{ "id": 1, "title": "Fix auth", "repos": [...], "repoCount": 2, ... }],
    "acme/api": [{ "id": 1, "title": "Fix auth", "repos": [...], "repoCount": 2, ... }]
  },
  "ungrouped": [{ "id": 3, "title": "Research caching", "repos": [], ... }]
}
```

Multi-repo tasks appear under each repo. `repoCount` lets the UI badge them.

**`GET /api/repos`** — all registered repos:

```sql
SELECT * FROM repos ORDER BY name
```

Returns `Repo[]`. Used by the task creation form's repo selector.

**`POST /api/tasks/:id/start`** — spawn agent:

1. Validate task exists, status is `todo`.
2. Check `claude-agent-acp` on PATH via `Bun.which()`.
3. Insert `agent_sessions` row (state: `starting`).
4. Spawn via `Bun.spawn`.
5. Parse stdout for session ID, update to `running`.
6. Update task status to `working`.
7. Broadcast via WebSocket.
8. Return `202 { session }`.

**`POST /api/tasks/:id/stop`** — stop agent:

1. Find running session for task.
2. SIGTERM the process; SIGKILL after 5s timeout.
3. Exit handler updates session state and broadcasts.
4. Return `200 { session }`.

---

## Shared Types

```typescript
// New
interface Repo {
  id: number;
  url: string;
  name: string;
  created_at: string;
}

// Updated — repos changes from string[] to Repo[]
interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  repos: Repo[];
  agent: AgentType;
  created_at: string;
}

// API response
interface TasksByProject {
  projects: Record<string, Task[]>;
  ungrouped: Task[];
}

// Create/update payloads
interface CreateTaskPayload {
  title: string;
  description?: string;
  repos?: string[];   // SSH URLs; server resolves to Repo objects
  agent?: AgentType;
}

interface UpdateTaskPayload {
  title?: string;
  description?: string;
  repos?: string[];
  agent?: AgentType;
}
```

---

## Frontend

### Routes

| Route | Component | Data |
|-------|-----------|------|
| `/` | `ProjectListView` | `GET /api/tasks/by-project` |
| `/tasks/new` | `TaskCreateForm` | `GET /api/repos` |
| `/tasks/:id` | `TaskDetailView` | `GET /api/tasks/:id` |
| `/login` | `LoginView` | (existing) |

### ProjectListView (`/`)

- Fetches `GET /api/tasks/by-project` via TanStack Query.
- Renders repo group headers (`acme/web`, `acme/api`, "No repository").
- Each group contains task cards.
- Sticky header with "+" button navigating to `/tasks/new`.
- Task cards show: title, status badge, agent name, repo count pill for multi-repo tasks.
- Tapping a card navigates to `/tasks/:id`.

### TaskCreateForm (`/tasks/new`)

- Full-page route with back button.
- Fields: Title (required), Description (optional textarea), Repositories (optional), Agent (select, defaults to `claude-code`).
- Repo selector: checkboxes for repos from `GET /api/repos` registry + "Add repository" button that reveals an inline SSH URL input.
- On submit: `POST /api/tasks` then navigate to `/` or `/tasks/:id`.
- All touch targets 44px minimum.

### TaskDetailView (`/tasks/:id`)

- Shows task title, status, agent, description, and repos.
- Repo management: same repo selector component, saves via `PATCH /api/tasks/:id`.
- Start/Stop button: calls `POST /api/tasks/:id/start` or `/stop`.
- Button state derived from task status (`todo` shows Start, `working` shows Stop).

### Component hierarchy

| Component | File | Purpose |
|-----------|------|---------|
| `ProjectListView` | `routes/index.tsx` | Main grouped task list |
| `RepoGroup` | `components/custom/repo-group.tsx` | Collapsible section per repo |
| `TaskCard` | `components/custom/task-card.tsx` | Tappable card with status + metadata |
| `TaskCreateForm` | `routes/tasks.new.tsx` | Full-page creation form |
| `TaskDetailView` | `routes/tasks.$id.tsx` | Task detail + agent controls |
| `RepoSelector` | `components/custom/repo-selector.tsx` | Shared checkbox list + add new |
| `AgentSelector` | `components/custom/agent-selector.tsx` | Agent type dropdown |
| `StatusBadge` | `components/custom/status-badge.tsx` | Colored status pill |

---

## ACP Agent Manager (`backend/src/lib/acp.ts`)

### Responsibilities

Pure library — no HTTP knowledge. Called by route handlers.

```typescript
// In-memory tracking
const sessions: Map<number, { proc: Subprocess; sessionId: number }> = new Map();

// Public API
spawnAgent(taskId: number, agentType: AgentType): AgentSession
stopAgent(sessionId: number): void
getRunningSession(taskId: number): AgentSession | null
```

### Spawn flow

1. `Bun.which('claude-agent-acp')` — throw if not found.
2. Insert `agent_sessions` row: `state: 'starting'`.
3. `Bun.spawn(['claude-agent-acp', '--agent', agentType], { stdout: 'pipe', stderr: 'pipe' })`.
4. Store in `sessions` Map keyed by session ID.
5. Async stdout reader:
   - Parse first message for external session ID. Update session to `running`.
   - Emit `eventBus('session_started', ...)`.
   - Subsequent lines: parse as ACP events, insert into `acp_events`, emit to eventBus.
6. On `proc.exited`:
   - Exit code 0 → `stopped`; non-zero → `crashed`.
   - Update `agent_sessions` (ended_at, exit_code, state).
   - Remove from Map.
   - Emit `eventBus('session_state_changed', ...)`.

### Stop flow

1. Look up session in Map.
2. `proc.kill('SIGTERM')`.
3. Race: `proc.exited` vs 5s timeout.
4. If timeout → `proc.kill('SIGKILL')`.
5. Exit handler (above) handles state cleanup.

### Server shutdown

On `SIGINT`/`SIGTERM`: iterate sessions Map, SIGTERM all, wait for exits, then shutdown.

### Crash recovery

On startup: `UPDATE agent_sessions SET state = 'interrupted' WHERE state IN ('starting', 'running')`. No auto-resume in v1.

### Stdout parsing

Assumes JSONL format from `claude-agent-acp`. First message contains session identifier. Subsequent messages have a `type` field (`thought`, `action`, `await_input`, `result`).

---

## Deferred (not in scope)

- Git worktree setup (Task 3.1)
- Terminal PTY attachment (Task 5.1)
- Input response endpoint (Task 4.3)
- Session resume/reconnect
- Collapsible repo group headers (nice-to-have for v1)

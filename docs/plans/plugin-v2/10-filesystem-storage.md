# Plugin System v2 — Filesystem Storage

## Decision

Replace persistent SQLite (`agemon.db`) with **filesystem-first storage + in-memory SQLite** for querying.

All durable state lives in JSON/JSONL files on disk. On startup, files are scanned and loaded into an in-memory SQLite database. All reads query in-memory SQLite (fast, full SQL). All writes go to the filesystem first (atomic rename), then update in-memory.

---

## Why

**Agent readability** — agents can `cat ~/.agemon/sessions/{id}/session.json` or read task files directly without API calls. Critical for Agemon's dogfooding use case (agents managing their own tasks, building their own plugins).

**No schema migrations** — adding a field to `session.json` requires no migration. Old files without the field get a default on read. Schema migrations for a personal tool are operational overhead with no benefit.

**Trivial backup** — `rsync ~/.agemon/ backup/` captures everything: sessions, events, tasks, settings. No `sqlite3 .dump` needed.

**Crash recovery is simple** — filesystem is always ≥ in-memory state. In-memory is rebuilt from filesystem on every startup. A crash can only leave in-memory stale, not ahead of filesystem.

---

## The One Rule

**Filesystem writes always happen before in-memory updates.**

```ts
// Correct
await atomicWrite(`${sessionDir}/session.json`, JSON.stringify(session));
db.run('UPDATE sessions SET state = ? WHERE id = ?', [state, id]);

// Wrong — never do this
db.run('UPDATE sessions SET state = ? WHERE id = ?', [state, id]);
await atomicWrite(...);  // if crash here, in-memory is ahead of filesystem
```

If process dies between filesystem write and in-memory update: next startup rebuilds from filesystem = correct state. The in-memory SQLite is always a projection of the filesystem, never ahead of it.

---

## Atomic Write Utility

```ts
// backend/src/lib/fs.ts
export async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = path + '.tmp';
  await Bun.write(tmp, data);
  await fs.rename(tmp, path);  // atomic on Linux/macOS — either succeeds fully or not at all
}

export async function atomicWriteJson(path: string, obj: unknown): Promise<void> {
  await atomicWrite(path, JSON.stringify(obj, null, 2));
}
```

No locking needed — Bun is single-threaded. `rename()` is atomic at the OS level.

---

## Core Filesystem Layout

```
~/.agemon/
├── settings.json                    ← key-value settings (replaces settings SQLite table)
├── sessions/
│   └── {id}/
│       ├── session.json             ← { id, agentType, state, pid, metaJson, externalSessionId, startedAt, endedAt }
│       ├── events.jsonl             ← ACP events (already implemented)
│       └── meta.json                ← checkpoint (already implemented)
├── plugins/
│   ├── tasks/                       ← tasks plugin filesystem namespace
│   │   └── tasks/
│   │       └── {id}.json            ← task data (see Tasks Plugin section)
│   └── {other-plugin}/
│       └── ...                      ← each plugin owns its subdirectory
└── repos/{org}--{repo}.git          ← bare repo caches (unchanged)
```

---

## Core In-Memory SQLite Schema

Rebuilt from `sessions/` on every startup:

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  agentType         TEXT NOT NULL,
  state             TEXT NOT NULL,  -- starting|ready|running|stopped|crashed|interrupted
  pid               INTEGER,
  metaJson          TEXT DEFAULT '{}',
  externalSessionId TEXT,
  startedAt         TEXT NOT NULL,
  endedAt           TEXT
);

-- Derived from sessions with pending_input (rebuilt from JSONL on startup)
CREATE TABLE awaiting_input (
  id         TEXT PRIMARY KEY,
  sessionId  TEXT NOT NULL,
  question   TEXT NOT NULL,
  status     TEXT NOT NULL  -- pending|answered
);
```

`settings` table is gone — read from `settings.json` directly (it's small, low-traffic).

---

## Startup Rebuild

```ts
// backend/src/lib/store.ts
export async function buildInMemoryDb(agemonDir: string): Promise<Database> {
  const db = new Database(':memory:');
  db.run(CREATE_SESSIONS_SQL);
  db.run(CREATE_AWAITING_INPUT_SQL);

  const sessionsDir = `${agemonDir}/sessions`;
  if (await exists(sessionsDir)) {
    for (const entry of await readdir(sessionsDir)) {
      const file = Bun.file(`${sessionsDir}/${entry}/session.json`);
      if (!(await file.exists())) continue;
      const session = await file.json();
      db.run(INSERT_SESSION_SQL, [session.id, session.agentType, session.state, ...]);
    }
  }

  // Rebuild awaiting_input from JSONL for sessions without a checkpoint
  await rebuildPendingInputs(db, agemonDir);

  return db;
}
```

For < 10,000 sessions: startup rebuild takes < 50ms. Acceptable.

---

## Write-Through Pattern

Every state mutation follows the same pattern:

```ts
// Update session state
async function setSessionState(session: Session, state: SessionState): Promise<void> {
  const updated = { ...session, state, ...(isTerminal(state) ? { endedAt: new Date().toISOString() } : {}) };

  // 1. Persist to filesystem (crash-safe)
  await atomicWriteJson(`${agemonDir}/sessions/${session.id}/session.json`, updated);

  // 2. Update in-memory projection
  db.run('UPDATE sessions SET state = ?, endedAt = ? WHERE id = ?',
    [state, updated.endedAt ?? null, session.id]);

  // 3. Broadcast WS event
  broadcast({ type: 'session_state_changed', sessionId: session.id, state });
}
```

---

## Plugin Filesystem Namespaces

Each plugin gets its own subdirectory under `~/.agemon/plugins/{pluginId}/` and its own in-memory SQLite:

```ts
interface PluginContext {
  pluginDataDir: string;    // ~/.agemon/plugins/{pluginId}/
  db: Database;             // in-memory SQLite, rebuilt from pluginDataDir on startup
  coreDb: Database;         // core in-memory SQLite, read-only
  atomicWrite(path: string, data: string): Promise<void>;
  // ...hooks, broadcast, createSession, etc.
}
```

Plugin is responsible for scanning its own `pluginDataDir` and populating `ctx.db` during `onLoad()`. Core provides the `atomicWrite` utility and calls `onLoad()` with the pre-initialized context.

---

## Tasks Plugin Filesystem Schema

```
~/.agemon/plugins/tasks/
└── tasks/
    └── {id}.json     ← full task + workspace config embedded
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

Workspace config embedded in `task.json` — no separate `task_workspaces` table needed. One file, one task, complete picture.

Task-to-session mapping derived on startup: scan `sessions/*/session.json`, extract `meta.task_id`, build `task_sessions` table in plugin's `ctx.db`.

Tasks plugin `onLoad()` populates `ctx.db`:
```sql
CREATE TABLE tasks (id, title, description, status, createdAt, workspaceProvider, workspaceConfig);
CREATE TABLE task_sessions (taskId, sessionId);  -- derived from session metaJson
```

---

## What Happens to agemon.db

The existing `agemon.db` is read during migration:

- Existing sessions: rows copied to `sessions/{id}/session.json`
- Existing tasks: rows copied to `plugins/tasks/tasks/{id}.json`
- Existing settings: copied to `settings.json`
- `acp_events`: kept as-is, read-only legacy fallback (new sessions use JSONL)
- After migration: `agemon.db` renamed to `agemon.db.migrated` (kept for rollback)

Migration runs once on first startup after upgrade. Detection: if `agemon.db` exists and `sessions/` doesn't.

---

## What This Removes

- `backend/src/db/` directory (migrations.ts, schema.sql, sessions.ts, tasks.ts, etc.)
- `DB_PATH` environment variable
- `bun:sqlite` import in core (plugins can still use it if they want)
- Schema migration system entirely

**~400 lines of DB infrastructure gone.** Core becomes smaller and simpler.

---

## Risk

**Only one real risk:** a filesystem write succeeds but the process crashes before the in-memory update. On next startup, in-memory is rebuilt from filesystem correctly. No data loss, no inconsistency.

**Not a risk:** concurrent writes. Bun is single-threaded. No two writes can interleave.

**Not a risk:** atomicity of single-file writes. `rename()` is atomic — the file is either the old version or the new version, never half-written.

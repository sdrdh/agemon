import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AGENT_TYPES as AGENT_TYPES_ARRAY } from '@agemon/shared';
import type { Task, ACPEvent, AwaitingInput, Diff, AgentSession, AgentSessionState, AgentType, Repo, TasksByProject, TaskStatus } from '@agemon/shared';

const DB_PATH = process.env.DB_PATH ?? './agemon.db';

if (DB_PATH.includes('..')) {
  throw new Error('DB_PATH must not contain ..');
}

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.run('PRAGMA journal_mode = WAL');
    _db.run('PRAGMA foreign_keys = ON');
  }
  return _db;
}

// ─── Migration ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 3;

/**
 * Extract a display name from a repo URL.
 * - SSH:   git@github.com:acme/web.git → acme/web
 * - HTTPS: https://github.com/org/repo  → org/repo
 * - Fallback: return the URL as-is
 */
export function parseRepoName(url: string): string {
  // SSH format: git@host:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS format: https://host/owner/repo(.git)?
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return url;
}

export function runMigrations() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  const row = db.query<{ v: number | null }, []>('SELECT MAX(version) as v FROM schema_version').get();
  const current = row?.v ?? 0;

  if (current < SCHEMA_VERSION) {
    const schemaPath = join(import.meta.dir, 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');
    db.transaction(() => {
      db.run(sql);

      // ── v3 migration: extract tasks.repos JSON → repos + task_repos tables ──
      if (current < 3) {
        // Check if the old tasks table still has a repos column
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('tasks')"
        ).all();
        const hasReposCol = cols.some(c => c.name === 'repos');

        if (hasReposCol) {
          // 1. Extract existing JSON repos into the new repos + task_repos tables
          const rows = db.query<{ id: string; repos: string }, []>(
            'SELECT id, repos FROM tasks'
          ).all();

          for (const row of rows) {
            let urls: string[];
            try {
              urls = JSON.parse(row.repos);
            } catch {
              urls = [];
            }
            if (!Array.isArray(urls)) urls = [];

            for (const url of urls) {
              if (typeof url !== 'string' || url.length === 0) continue;

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
                  [row.id, repo.id]
                );
              }
            }
          }

          // 2. Recreate tasks table without the repos column
          db.run(`
            CREATE TABLE tasks_new (
              id          TEXT PRIMARY KEY,
              title       TEXT NOT NULL CHECK (length(title) <= 500),
              description TEXT CHECK (description IS NULL OR length(description) <= 10000),
              status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
              agent       TEXT NOT NULL DEFAULT 'claude-code'
                            CHECK (agent IN ('claude-code', 'opencode', 'aider', 'gemini')),
              created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);

          db.run(`
            INSERT INTO tasks_new (id, title, description, status, agent, created_at)
            SELECT id, title, description, status, agent, created_at FROM tasks
          `);

          db.run('DROP TABLE tasks');
          db.run('ALTER TABLE tasks_new RENAME TO tasks');
        }
      }

      db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
    })();
    console.log(`[db] migrated to schema version ${SCHEMA_VERSION}`);
  }
}

// ─── Query Helpers ────────────────────────────────────────────────────────────

interface RawTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  agent: string;
  created_at: string;
}

const TASK_STATUSES = new Set<Task['status']>(['todo', 'working', 'awaiting_input', 'done']);
const AGENT_TYPES_SET = new Set<AgentType>(AGENT_TYPES_ARRAY);
const TERMINAL_STATES = new Set<AgentSessionState>(['stopped', 'crashed', 'interrupted']);

function parseTask(row: RawTask): Omit<Task, 'repos'> {
  const status = TASK_STATUSES.has(row.status as Task['status'])
    ? (row.status as Task['status'])
    : (() => { throw new Error(`[db] unexpected task status: ${row.status}`); })();
  const agent = AGENT_TYPES_SET.has(row.agent as AgentType)
    ? (row.agent as AgentType)
    : (() => { throw new Error(`[db] unexpected agent type: ${row.agent}`); })();
  return { id: row.id, title: row.title, description: row.description, status, agent, created_at: row.created_at };
}

const SESSION_STATES = new Set<AgentSessionState>([
  'starting', 'running', 'stopped', 'crashed', 'interrupted',
]);

function parseSession(row: AgentSession): AgentSession {
  if (!SESSION_STATES.has(row.state)) {
    throw new Error(`[db] unexpected session state: ${row.state}`);
  }
  if (!AGENT_TYPES_SET.has(row.agent_type)) {
    throw new Error(`[db] unexpected agent type: ${row.agent_type}`);
  }
  return row;
}

export const db = {
  // ── Repos ──

  listRepos(): Repo[] {
    const database = getDb();
    return database.query<Repo, []>('SELECT * FROM repos ORDER BY name').all();
  },

  upsertRepo(url: string): Repo {
    const database = getDb();
    const name = parseRepoName(url);
    database.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [url, name]);
    const row = database.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url);
    if (!row) throw new Error(`[db] failed to upsert repo with url ${url}`);
    return row;
  },

  getTaskRepos(taskId: string): Repo[] {
    const database = getDb();
    return database.query<Repo, [string]>(
      `SELECT r.* FROM repos r
       JOIN task_repos tr ON tr.repo_id = r.id
       WHERE tr.task_id = ?
       ORDER BY r.name`
    ).all(taskId);
  },

  /** Batch-fetch repos for multiple tasks in 2 queries (avoids N+1). */
  _buildRepoMap(taskIds: string[]): Map<string, Repo[]> {
    const map = new Map<string, Repo[]>();
    if (taskIds.length === 0) return map;

    const database = getDb();
    interface TaskRepoLink { task_id: string; repo_id: number; url: string; name: string; created_at: string }
    const placeholders = taskIds.map(() => '?').join(',');
    const links = database.query<TaskRepoLink, string[]>(
      `SELECT tr.task_id, r.id as repo_id, r.url, r.name, r.created_at
       FROM task_repos tr
       JOIN repos r ON r.id = tr.repo_id
       WHERE tr.task_id IN (${placeholders})
       ORDER BY r.name`
    ).all(...taskIds);

    for (const link of links) {
      let repos = map.get(link.task_id);
      if (!repos) { repos = []; map.set(link.task_id, repos); }
      repos.push({ id: link.repo_id, url: link.url, name: link.name, created_at: link.created_at });
    }
    return map;
  },

  setTaskRepos(taskId: string, repoUrls: string[]): Repo[] {
    const database = getDb();
    const repos: Repo[] = [];
    database.transaction(() => {
      database.run('DELETE FROM task_repos WHERE task_id = ?', [taskId]);
      for (const url of repoUrls) {
        const repo = this.upsertRepo(url);
        database.run(
          'INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)',
          [taskId, repo.id]
        );
        repos.push(repo);
      }
    })();
    return repos;
  },

  // ── Tasks ──

  listTasks(): Task[] {
    const database = getDb();
    const rows = database.query<RawTask, []>('SELECT * FROM tasks ORDER BY created_at DESC').all();
    const repoMap = this._buildRepoMap(rows.map(r => r.id));
    return rows.map(row => ({
      ...parseTask(row),
      repos: repoMap.get(row.id) ?? [],
    }));
  },

  getTask(id: string): Task | null {
    const database = getDb();
    const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    return { ...parseTask(row), repos: this.getTaskRepos(id) };
  },

  createTask(task: { id: string; title: string; description: string | null; status: TaskStatus; agent: AgentType; repos?: string[] }): Task {
    const database = getDb();
    let repos: Repo[] = [];
    database.transaction(() => {
      database.run(
        'INSERT INTO tasks (id, title, description, status, agent) VALUES (?, ?, ?, ?, ?)',
        [task.id, task.title, task.description ?? null, task.status, task.agent]
      );
      if (task.repos) repos = this.setTaskRepos(task.id, task.repos);
    })();
    const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(task.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted task with id ${task.id}`);
    return { ...parseTask(row), repos };
  },

  updateTask(id: string, fields: { title?: string; description?: string | null; status?: TaskStatus; agent?: AgentType; repos?: string[] }): Task | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
    if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.agent !== undefined) { sets.push('agent = ?'); values.push(fields.agent); }

    const database = getDb();

    database.transaction(() => {
      if (sets.length > 0) {
        values.push(id);
        database.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
      }
      if (fields.repos !== undefined) {
        this.setTaskRepos(id, fields.repos);
      }
    })();

    const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    return { ...parseTask(row), repos: this.getTaskRepos(id) };
  },

  deleteTask(id: string): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM tasks WHERE id = ?', [id]);
    return result.changes > 0;
  },

  listTasksByProject(): TasksByProject {
    const database = getDb();

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

    const ungroupedRows = database.query<RawTask, []>(`
      SELECT t.* FROM tasks t
      WHERE t.id NOT IN (SELECT task_id FROM task_repos)
      ORDER BY t.created_at DESC
    `).all();

    const allTaskIds = new Set<string>();
    for (const row of taskRepoRows) allTaskIds.add(row.id);
    for (const row of ungroupedRows) allTaskIds.add(row.id);
    const repoCache = this._buildRepoMap([...allTaskIds]);

    const projects: Record<string, Task[]> = {};
    const seenPerProject = new Map<string, Set<string>>();

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

  // ── Agent Sessions ──

  getSession(id: string): AgentSession | null {
    const db = getDb();
    const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(id);
    return row ? parseSession(row) : null;
  },

  listSessions(taskId: string): AgentSession[] {
    const db = getDb();
    return db.query<AgentSession, [string]>(
      'SELECT * FROM agent_sessions WHERE task_id = ? ORDER BY started_at ASC'
    ).all(taskId).map(parseSession);
  },

  listSessionsByState(state: AgentSessionState): AgentSession[] {
    const db = getDb();
    return db.query<AgentSession, [string]>(
      'SELECT * FROM agent_sessions WHERE state = ? ORDER BY started_at ASC'
    ).all(state).map(parseSession);
  },

  insertSession(session: Pick<AgentSession, 'id' | 'task_id' | 'agent_type' | 'pid'>): AgentSession {
    const db = getDb();
    db.run(
      'INSERT INTO agent_sessions (id, task_id, agent_type, pid) VALUES (?, ?, ?, ?)',
      [session.id, session.task_id, session.agent_type, session.pid ?? null]
    );
    const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(session.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted session with id ${session.id}`);
    return parseSession(row);
  },

  updateSessionState(
    id: string,
    state: AgentSessionState,
    extra?: { external_session_id?: string; pid?: number | null; exit_code?: number | null }
  ): AgentSession | null {
    const db = getDb();
    const sets: string[] = ['state = ?'];
    const values: (string | number | null)[] = [state];

    if (extra?.external_session_id !== undefined) {
      sets.push('external_session_id = ?');
      values.push(extra.external_session_id);
    }
    if (extra?.pid !== undefined) {
      sets.push('pid = ?');
      values.push(extra.pid ?? null);
    }
    if (extra?.exit_code !== undefined) {
      sets.push('exit_code = ?');
      values.push(extra.exit_code ?? null);
    }

    if (TERMINAL_STATES.has(state)) {
      sets.push("ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    }

    values.push(id);
    db.run(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
    const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(id);
    return row ? parseSession(row) : null;
  },

  // ── ACP Events ──

  listEvents(taskId: string, limit: number): ACPEvent[] {
    const db = getDb();
    return db.query<ACPEvent, [string, number]>(
      'SELECT * FROM acp_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(taskId, limit);
  },

  insertEvent(event: Omit<ACPEvent, 'created_at'>): ACPEvent {
    const db = getDb();
    db.run(
      'INSERT INTO acp_events (id, task_id, session_id, type, content) VALUES (?, ?, ?, ?, ?)',
      [event.id, event.task_id, event.session_id, event.type, event.content]
    );
    const row = db.query<ACPEvent, [string]>('SELECT * FROM acp_events WHERE id = ?').get(event.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted event with id ${event.id}`);
    return row;
  },

  // ── Awaiting Input ──

  listPendingInputs(taskId: string): AwaitingInput[] {
    const db = getDb();
    return db.query<AwaitingInput, [string]>(
      "SELECT * FROM awaiting_input WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC"
    ).all(taskId);
  },

  insertAwaitingInput(input: Omit<AwaitingInput, 'created_at' | 'response' | 'status'>): AwaitingInput {
    const db = getDb();
    db.run(
      'INSERT INTO awaiting_input (id, task_id, session_id, question) VALUES (?, ?, ?, ?)',
      [input.id, input.task_id, input.session_id, input.question]
    );
    const row = db.query<AwaitingInput, [string]>('SELECT * FROM awaiting_input WHERE id = ?').get(input.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted awaiting_input with id ${input.id}`);
    return row;
  },

  answerInput(id: string, response: string): AwaitingInput | null {
    const db = getDb();
    db.run("UPDATE awaiting_input SET status = 'answered', response = ? WHERE id = ?", [response, id]);
    return db.query<AwaitingInput, [string]>('SELECT * FROM awaiting_input WHERE id = ?').get(id) ?? null;
  },

  // ── Diffs ──

  getDiff(id: string): Diff | null {
    const db = getDb();
    return db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(id) ?? null;
  },

  getPendingDiff(taskId: string): Diff | null {
    const db = getDb();
    return db.query<Diff, [string]>(
      "SELECT * FROM diffs WHERE task_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    ).get(taskId) ?? null;
  },

  insertDiff(diff: Omit<Diff, 'created_at' | 'status'>): Diff {
    const db = getDb();
    db.run('INSERT INTO diffs (id, task_id, content) VALUES (?, ?, ?)', [diff.id, diff.task_id, diff.content]);
    const row = db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(diff.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted diff with id ${diff.id}`);
    return row;
  },

  updateDiffStatus(id: string, status: 'approved' | 'rejected'): Diff | null {
    const db = getDb();
    db.run('UPDATE diffs SET status = ? WHERE id = ?', [status, id]);
    return db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(id) ?? null;
  },
};

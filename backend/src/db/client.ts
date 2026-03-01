import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Task, ACPEvent, AwaitingInput, Diff, TerminalSession } from '@agemon/shared';

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

const SCHEMA_VERSION = 1;

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
    db.run(sql);
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
    console.log(`[db] migrated to schema version ${SCHEMA_VERSION}`);
  }
}

// ─── Query Helpers ────────────────────────────────────────────────────────────

interface RawTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  repos: string;
  agent: string;
  created_at: string;
}

const TASK_STATUSES = new Set<Task['status']>(['todo', 'working', 'awaiting_input', 'done']);
const AGENT_TYPES = new Set<Task['agent']>(['claude-code', 'aider', 'gemini']);

function parseTask(row: RawTask): Task {
  const status = TASK_STATUSES.has(row.status as Task['status'])
    ? (row.status as Task['status'])
    : (() => { throw new Error(`[db] unexpected task status: ${row.status}`); })();
  const agent = AGENT_TYPES.has(row.agent as Task['agent'])
    ? (row.agent as Task['agent'])
    : (() => { throw new Error(`[db] unexpected agent type: ${row.agent}`); })();
  return { ...row, status, agent, repos: JSON.parse(row.repos) };
}

export const db = {
  // ── Tasks ──

  listTasks(): Task[] {
    const db = getDb();
    return db.query<RawTask, []>('SELECT * FROM tasks ORDER BY created_at DESC').all().map(parseTask);
  },

  getTask(id: string): Task | null {
    const db = getDb();
    const row = db.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? parseTask(row) : null;
  },

  createTask(task: Omit<Task, 'created_at'>): Task {
    const database = getDb();
    database.run(
      'INSERT INTO tasks (id, title, description, status, repos, agent) VALUES (?, ?, ?, ?, ?, ?)',
      [task.id, task.title, task.description ?? null, task.status, JSON.stringify(task.repos), task.agent]
    );
    const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(task.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted task with id ${task.id}`);
    return parseTask(row);
  },

  updateTask(id: string, fields: Partial<Omit<Task, 'id' | 'created_at'>>): Task | null {
    const sets: string[] = [];
    const values: unknown[] = [];

    // Field names below are hardcoded (not user-supplied) — safe from SQL injection.
    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
    if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description); }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.repos !== undefined) { sets.push('repos = ?'); values.push(JSON.stringify(fields.repos)); }
    if (fields.agent !== undefined) { sets.push('agent = ?'); values.push(fields.agent); }

    const database = getDb();
    if (sets.length === 0) {
      const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
      return row ? parseTask(row) : null;
    }

    values.push(id);
    database.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values as string[]);
    const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? parseTask(row) : null;
  },

  deleteTask(id: string): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM tasks WHERE id = ?', [id]);
    return result.changes > 0;
  },

  // ── ACP Events ──

  listEvents(taskId: string): ACPEvent[] {
    const db = getDb();
    return db.query<ACPEvent, [string]>(
      'SELECT * FROM acp_events WHERE task_id = ? ORDER BY created_at ASC'
    ).all(taskId);
  },

  insertEvent(event: Omit<ACPEvent, 'created_at'>): ACPEvent {
    const db = getDb();
    db.run(
      'INSERT INTO acp_events (id, task_id, type, content) VALUES (?, ?, ?, ?)',
      [event.id, event.task_id, event.type, event.content]
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
      'INSERT INTO awaiting_input (id, task_id, question) VALUES (?, ?, ?)',
      [input.id, input.task_id, input.question]
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

  // ── Terminal Sessions ──

  getTerminalSession(id: string): TerminalSession | null {
    const db = getDb();
    return db.query<TerminalSession, [string]>('SELECT * FROM terminal_sessions WHERE id = ?').get(id) ?? null;
  },

  listTerminalSessions(taskId: string): TerminalSession[] {
    const db = getDb();
    return db.query<TerminalSession, [string]>(
      'SELECT * FROM terminal_sessions WHERE task_id = ? ORDER BY created_at DESC'
    ).all(taskId);
  },

  insertTerminalSession(session: Omit<TerminalSession, 'created_at'>): TerminalSession {
    const db = getDb();
    db.run(
      'INSERT INTO terminal_sessions (id, task_id, shell, pid) VALUES (?, ?, ?, ?)',
      [session.id, session.task_id, session.shell, session.pid ?? null]
    );
    const row = db.query<TerminalSession, [string]>('SELECT * FROM terminal_sessions WHERE id = ?').get(session.id);
    if (!row) throw new Error(`[db] failed to retrieve newly inserted terminal_session with id ${session.id}`);
    return row;
  },
};

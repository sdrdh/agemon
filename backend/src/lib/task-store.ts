/**
 * Filesystem-backed task store + in-memory SQLite projection.
 *
 * Write path:
 *   1. Update in-memory SQLite
 *   2. Flush task JSON to disk atomically
 *
 * Task dirs: {dataDir}/tasks/{id}.json (active) | {id}_archived.json (archived)
 * This mirrors the session-store pattern so the rest of the codebase can treat
 * task data the same way it treats session data.
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { atomicWriteJsonSync, ensureDir } from './fs.ts';
import { parseTask, parseRepoName, TASK_STATUSES, AGENT_TYPES_SET, type RawTask } from '../db/helpers.ts';
import type { Task, TaskStatus, AgentType, Repo, TaskWorkspace, TasksByProject } from '@agemon/shared';

// ─── File Shape ───────────────────────────────────────────────────────────────

export interface TaskFileShape {
  id: string;
  title: string;
  description: string | null;
  status: string;
  agent: string;
  archived: boolean;
  workspace_json: string | null;
  repos: Array<{ url: string; name: string }>;
  created_at: string;
}

// ─── Module State ─────────────────────────────────────────────────────────────

let _taskDb: Database | null = null;
let _taskDataDir: string | null = null;

// ─── In-Memory Schema ─────────────────────────────────────────────────────────

const CREATE_SCHEMA = `
  CREATE TABLE tasks (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    description    TEXT,
    status         TEXT NOT NULL DEFAULT 'todo',
    agent          TEXT NOT NULL DEFAULT 'claude-code',
    archived       INTEGER NOT NULL DEFAULT 0,
    workspace_json TEXT DEFAULT NULL,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE repos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    url        TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE task_repos (
    task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, repo_id)
  );
  CREATE INDEX idx_task_repos_repo ON task_repos(repo_id);
`;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Scan {dataDir}/tasks/*.json + *_archived.json, populate in-memory SQLite.
 * Call once at startup before any task functions are used.
 */
export function buildTaskDb(dataDir: string): Database {
  _taskDataDir = dataDir;
  _taskDb = new Database(':memory:');
  _taskDb.run('PRAGMA foreign_keys = ON');
  _taskDb.run(CREATE_SCHEMA);

  const tasksDir = join(dataDir, 'tasks');
  if (!existsSync(tasksDir)) return _taskDb;

  let entries: string[];
  try { entries = readdirSync(tasksDir); } catch { return _taskDb; }

  let loaded = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(tasksDir, entry), 'utf8');
      const shape: TaskFileShape = JSON.parse(raw);
      _insertTaskShape(_taskDb, shape);
      loaded++;
    } catch (err) {
      console.warn(`[task-store] failed to load ${entry}:`, (err as Error).message);
    }
  }

  console.info(`[task-store] loaded ${loaded} task(s) from filesystem`);
  return _taskDb;
}

export function getTaskDb(): Database {
  if (!_taskDb) throw new Error('[task-store] DB not initialized — call buildTaskDb() first');
  return _taskDb;
}

export function getTaskDataDir(): string {
  if (!_taskDataDir) throw new Error('[task-store] not initialized — call buildTaskDb() first');
  return _taskDataDir;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _insertTaskShape(db: Database, shape: TaskFileShape): void {
  db.run(
    `INSERT OR REPLACE INTO tasks (id, title, description, status, agent, archived, workspace_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [shape.id, shape.title, shape.description ?? null, shape.status, shape.agent,
     shape.archived ? 1 : 0, shape.workspace_json ?? null, shape.created_at]
  );
  for (const repo of shape.repos ?? []) {
    db.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [repo.url, repo.name]);
    const repoRow = db.query<{ id: number }, [string]>('SELECT id FROM repos WHERE url = ?').get(repo.url);
    if (repoRow) {
      db.run('INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)', [shape.id, repoRow.id]);
    }
  }
}

function _taskToFileShape(taskId: string): TaskFileShape | null {
  const db = getTaskDb();
  const row = db.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!row) return null;
  const repoRows = db.query<{ url: string; name: string }, [string]>(
    `SELECT r.url, r.name FROM repos r
     JOIN task_repos tr ON tr.repo_id = r.id
     WHERE tr.task_id = ? ORDER BY r.name`
  ).all(taskId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    agent: row.agent,
    archived: !!row.archived,
    workspace_json: row.workspace_json ?? null,
    repos: repoRows,
    created_at: row.created_at,
  };
}

function _taskFilename(archived: boolean): string {
  return archived ? '_archived.json' : '.json';
}

/** Write task JSON to disk. Updates both active and archived filenames correctly. */
export function flushTaskJson(taskId: string): void {
  const dir = _taskDataDir;
  if (!dir) return;
  const shape = _taskToFileShape(taskId);
  if (!shape) return;

  const tasksDir = join(dir, 'tasks');
  ensureDir(tasksDir);

  const targetFile = join(tasksDir, taskId + _taskFilename(shape.archived));
  const staleFile = join(tasksDir, taskId + _taskFilename(!shape.archived));

  atomicWriteJsonSync(targetFile, shape);
  if (existsSync(staleFile)) unlinkSync(staleFile);
}

function _deleteTaskFile(taskId: string): void {
  const dir = _taskDataDir;
  if (!dir) return;
  const tasksDir = join(dir, 'tasks');
  for (const suffix of ['.json', '_archived.json']) {
    const f = join(tasksDir, taskId + suffix);
    if (existsSync(f)) unlinkSync(f);
  }
}

// ─── Repo Helpers (task-scoped, uses in-memory DB) ───────────────────────────

export function getTaskRepos(taskId: string): Repo[] {
  const db = getTaskDb();
  return db.query<Repo, [string]>(
    `SELECT r.* FROM repos r
     JOIN task_repos tr ON tr.repo_id = r.id
     WHERE tr.task_id = ? ORDER BY r.name`
  ).all(taskId);
}

export function setTaskRepos(taskId: string, repoUrls: string[]): Repo[] {
  const db = getTaskDb();
  const repos: Repo[] = [];
  db.transaction(() => {
    db.run('DELETE FROM task_repos WHERE task_id = ?', [taskId]);
    for (const url of repoUrls) {
      const name = parseRepoName(url);
      db.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [url, name]);
      const repoRow = db.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url);
      if (repoRow) {
        db.run('INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)', [taskId, repoRow.id]);
        repos.push(repoRow);
      }
    }
  })();
  return repos;
}

export function buildRepoMap(taskIds: string[]): Map<string, Repo[]> {
  const map = new Map<string, Repo[]>();
  if (taskIds.length === 0) return map;
  const db = getTaskDb();
  interface TaskRepoLink { task_id: string; repo_id: number; url: string; name: string; created_at: string }
  const placeholders = taskIds.map(() => '?').join(',');
  const links = db.query<TaskRepoLink, string[]>(
    `SELECT tr.task_id, r.id as repo_id, r.url, r.name, r.created_at
     FROM task_repos tr JOIN repos r ON r.id = tr.repo_id
     WHERE tr.task_id IN (${placeholders}) ORDER BY r.name`
  ).all(...taskIds);
  for (const link of links) {
    let repos = map.get(link.task_id);
    if (!repos) { repos = []; map.set(link.task_id, repos); }
    repos.push({ id: link.repo_id, url: link.url, name: link.name, created_at: link.created_at });
  }
  return map;
}

// ─── Task CRUD ────────────────────────────────────────────────────────────────

export function listTasks(includeArchived = false): Task[] {
  const db = getTaskDb();
  const where = includeArchived ? '' : 'WHERE archived = 0';
  const rows = db.query<RawTask, []>(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all();
  const repoMap = buildRepoMap(rows.map(r => r.id));
  return rows.map(row => ({ ...parseTask(row), repos: repoMap.get(row.id) ?? [] }));
}

export function getTask(id: string): Task | null {
  const db = getTaskDb();
  const row = db.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return { ...parseTask(row), repos: getTaskRepos(id) };
}

export function createTask(task: {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  agent: AgentType;
  repos?: string[];
  workspace?: TaskWorkspace;
}): Task {
  const db = getTaskDb();
  let repos: Repo[] = [];

  let workspaceJson: string | null = null;
  if (task.workspace) {
    workspaceJson = JSON.stringify(task.workspace);
  } else if (task.repos && task.repos.length > 0) {
    workspaceJson = JSON.stringify({ provider: 'git-worktree', config: { repos: task.repos } });
  }

  db.transaction(() => {
    db.run(
      'INSERT INTO tasks (id, title, description, status, agent, workspace_json) VALUES (?, ?, ?, ?, ?, ?)',
      [task.id, task.title, task.description ?? null, task.status, task.agent, workspaceJson]
    );
    if (task.repos) repos = setTaskRepos(task.id, task.repos);
  })();

  const row = db.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(task.id);
  if (!row) throw new Error(`[task-store] failed to retrieve newly inserted task ${task.id}`);
  flushTaskJson(task.id);
  return { ...parseTask(row), repos };
}

export function updateTask(
  id: string,
  fields: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    agent?: AgentType;
    repos?: string[];
    archived?: boolean;
    workspace?: TaskWorkspace;
  }
): Task | null {
  const db = getTaskDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
  if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
  if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
  if (fields.agent !== undefined) { sets.push('agent = ?'); values.push(fields.agent); }
  if (fields.archived !== undefined) { sets.push('archived = ?'); values.push(fields.archived ? 1 : 0); }
  if (fields.workspace !== undefined) { sets.push('workspace_json = ?'); values.push(JSON.stringify(fields.workspace)); }

  db.transaction(() => {
    if (sets.length > 0) {
      values.push(id);
      db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
    }
    if (fields.repos !== undefined) {
      setTaskRepos(id, fields.repos);
    }
  })();

  const row = db.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  flushTaskJson(id);
  return { ...parseTask(row), repos: getTaskRepos(id) };
}

export function deleteTask(id: string): boolean {
  const db = getTaskDb();
  const result = db.run('DELETE FROM tasks WHERE id = ?', [id]);
  if (result.changes > 0) _deleteTaskFile(id);
  return result.changes > 0;
}

export function listTasksByProject(includeArchived = false): TasksByProject {
  const db = getTaskDb();
  const archiveFilter = includeArchived ? '' : 'AND t.archived = 0';

  interface TaskRepoRow extends RawTask { repo_url: string; repo_name: string }
  const taskRepoRows = db.query<TaskRepoRow, []>(`
    SELECT t.*, r.url as repo_url, r.name as repo_name
    FROM tasks t
    JOIN task_repos tr ON tr.task_id = t.id
    JOIN repos r ON r.id = tr.repo_id
    WHERE 1=1 ${archiveFilter}
    ORDER BY r.name, t.created_at DESC
  `).all();

  const ungroupedRows = db.query<RawTask, []>(`
    SELECT t.* FROM tasks t
    WHERE t.id NOT IN (SELECT task_id FROM task_repos)
    ${archiveFilter}
    ORDER BY t.created_at DESC
  `).all();

  const allTaskIds = new Set<string>();
  for (const row of taskRepoRows) allTaskIds.add(row.id);
  for (const row of ungroupedRows) allTaskIds.add(row.id);
  const repoCache = buildRepoMap([...allTaskIds]);

  const projects: Record<string, Task[]> = {};
  const seenPerProject = new Map<string, Set<string>>();
  for (const row of taskRepoRows) {
    const repoName = row.repo_name;
    if (!projects[repoName]) { projects[repoName] = []; seenPerProject.set(repoName, new Set()); }
    const seen = seenPerProject.get(repoName)!;
    if (!seen.has(row.id)) {
      seen.add(row.id);
      projects[repoName].push({ ...parseTask(row), repos: repoCache.get(row.id) ?? [] });
    }
  }

  const ungrouped: Task[] = ungroupedRows.map(row => ({ ...parseTask(row), repos: [] }));
  return { projects, ungrouped };
}

/** Used by generateTaskId() to check existing IDs. */
export function queryTaskIds(base: string): { id: string }[] {
  const db = getTaskDb();
  return db.query<{ id: string }, [string, string]>(
    "SELECT id FROM tasks WHERE id = ? OR id LIKE ? || '-%'"
  ).all(base, base);
}

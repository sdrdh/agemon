/**
 * One-time migration: copy agent_sessions + settings + tasks from agemon.db → filesystem.
 *
 * Guards:
 *   - No agemon.db → fresh install, skip.
 *   - Any sessions/{id}/session.json already exists → sessions already migrated, skip sessions.
 *   - Any plugins/tasks/data/tasks/*.json exists → tasks already migrated, skip tasks.
 *
 * agemon.db is NOT deleted — repos/approvals/events continue to use it.
 */
import { Database } from 'bun:sqlite';
import { join, resolve } from 'path';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import type { SessionFileShape } from './session-store.ts';
import type { TaskFileShape } from './task-store.ts';

export async function runFilesystemMigration(agemonDir: string): Promise<void> {
  const dbPath = process.env.DB_PATH
    ? resolve(process.env.DB_PATH)
    : join(agemonDir, 'agemon.db');

  // 1. No agemon.db → fresh install
  if (!existsSync(dbPath)) {
    console.info('[migration] no agemon.db found — fresh install, skipping');
    return;
  }

  // 2. Open agemon.db read-only
  let sourceDb: Database;
  try {
    sourceDb = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.warn('[migration] could not open agemon.db read-only:', (err as Error).message);
    return;
  }

  try {
    await migrateSessionsToFilesystem(agemonDir, sourceDb);
    await migrateSettingsToFilesystem(agemonDir, sourceDb);
    await migrateTasksToFilesystem(agemonDir, sourceDb);
  } finally {
    sourceDb.close();
  }
}

async function migrateSessionsToFilesystem(agemonDir: string, sourceDb: Database): Promise<void> {
  const sessionsDir = join(agemonDir, 'sessions');

  // Already migrated?
  if (existsSync(sessionsDir)) {
    let entries: string[];
    try { entries = readdirSync(sessionsDir); } catch { entries = []; }
    const alreadyMigrated = entries.some(e => existsSync(join(sessionsDir, e, 'session.json')));
    if (alreadyMigrated) {
      console.info('[migration] session.json files already exist — skipping session migration');
      return;
    }
  }

  const hasSessionsTable = sourceDb.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'"
  ).get();

  if (!hasSessionsTable) return;

  const rows = sourceDb.query<Record<string, unknown>, []>('SELECT * FROM agent_sessions').all();
  let migrated = 0;

  for (const row of rows) {
    const sessionId = row.id as string;

    let sessionDir: string | null = null;
    if (existsSync(sessionsDir)) {
      const entries = readdirSync(sessionsDir);
      const match = entries.find(e => e.endsWith(`_${sessionId}`));
      if (match) sessionDir = join(sessionsDir, match);
    }
    if (!sessionDir) {
      sessionDir = join(sessionsDir, sessionId);
      mkdirSync(sessionDir, { recursive: true });
    }

    const shape: SessionFileShape = {
      id: sessionId,
      agentType: row.agent_type as string,
      state: row.state as string,
      pid: (row.pid ?? null) as number | null,
      name: (row.name ?? null) as string | null,
      metaJson: (row.meta_json ?? '{}') as string,
      externalSessionId: (row.external_session_id ?? null) as string | null,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at ?? null) as string | null,
      exitCode: (row.exit_code ?? null) as number | null,
      archived: !!(row.archived as number),
      usageJson: (row.usage_json ?? null) as string | null,
      lastMessage: (row.last_message ?? null) as string | null,
      configOptions: (row.config_options ?? null) as string | null,
      availableCommands: (row.available_commands ?? null) as string | null,
    };

    const filename = shape.archived ? 'session_archived.json' : 'session.json';
    atomicWriteJsonSync(join(sessionDir, filename), shape);
    migrated++;
  }

  console.info(`[migration] migrated ${migrated} session(s) to filesystem`);
}

async function migrateSettingsToFilesystem(agemonDir: string, sourceDb: Database): Promise<void> {
  const settingsPath = join(agemonDir, 'settings.json');
  if (existsSync(settingsPath)) return;

  const hasSettingsTable = sourceDb.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
  ).get();

  if (!hasSettingsTable) return;

  const rows = sourceDb.query<{ key: string; value: string }, []>('SELECT key, value FROM settings').all();
  const settingsObj = Object.fromEntries(rows.map(r => [r.key, r.value]));
  atomicWriteJsonSync(settingsPath, settingsObj);
  console.info(`[migration] migrated ${rows.length} setting(s) to settings.json`);
}

async function migrateTasksToFilesystem(agemonDir: string, sourceDb: Database): Promise<void> {
  const taskDataDir = join(agemonDir, 'plugins', 'tasks', 'data');
  const tasksDir = join(taskDataDir, 'tasks');

  // Already migrated?
  if (existsSync(tasksDir)) {
    let entries: string[];
    try { entries = readdirSync(tasksDir); } catch { entries = []; }
    if (entries.some(e => e.endsWith('.json'))) {
      console.info('[migration] task JSON files already exist — skipping task migration');
      return;
    }
  }

  const hasTasksTable = sourceDb.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get();

  if (!hasTasksTable) return;

  mkdirSync(tasksDir, { recursive: true });

  interface RawTaskRow {
    id: string; title: string; description: string | null;
    status: string; agent: string; archived: number;
    workspace_json: string | null; created_at: string;
  }
  interface RepoRow { url: string; name: string }

  const tasks = sourceDb.query<RawTaskRow, []>('SELECT * FROM tasks').all();

  // Check if repos/task_repos tables exist for joining
  const hasRepos = !!sourceDb.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='task_repos'"
  ).get();

  let migrated = 0;
  for (const task of tasks) {
    let repos: RepoRow[] = [];
    if (hasRepos) {
      repos = sourceDb.query<RepoRow, [string]>(
        `SELECT r.url, r.name FROM repos r
         JOIN task_repos tr ON tr.repo_id = r.id
         WHERE tr.task_id = ? ORDER BY r.name`
      ).all(task.id);
    }

    const shape: TaskFileShape = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      agent: task.agent,
      archived: !!task.archived,
      workspace_json: task.workspace_json ?? null,
      repos,
      created_at: task.created_at,
    };

    const filename = shape.archived ? `${task.id}_archived.json` : `${task.id}.json`;
    atomicWriteJsonSync(join(tasksDir, filename), shape);
    migrated++;
  }

  console.info(`[migration] migrated ${migrated} task(s) to filesystem`);
}

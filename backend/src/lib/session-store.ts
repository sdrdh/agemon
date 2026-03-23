/**
 * In-memory SQLite projection of sessions, backed by per-session session.json files.
 *
 * Write path:
 *   1. Update in-memory SQLite
 *   2. Flush session.json to disk (if session dir is known)
 *
 * Session dirs are registered by event-log.ts after initSessionLog() creates the dir.
 * Until then, the session is buffered in _pending and flushed when writeSessionJson() is called.
 */
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { sessionDirs } from './acp/session-dirs.ts';
import { parseSession, TERMINAL_STATES } from '../db/helpers.ts';
import type { AgentSession, AgentSessionState, SessionConfigOption, SessionUsage, AgentCommand } from '@agemon/shared';

// ─── SessionFileShape ─────────────────────────────────────────────────────────

export interface SessionFileShape {
  id: string;
  agentType: string;
  state: string;
  pid: number | null;
  name: string | null;
  metaJson: string;
  externalSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  archived: boolean;
  usageJson: string | null;
  lastMessage: string | null;
  configOptions: string | null;
  availableCommands: string | null;
}

// ─── Filename Convention ──────────────────────────────────────────────────────
// session.json          → active (archived = false)
// session_archived.json → archived (archived = true)
// This lets filesystem queries trivially filter: find -name "session.json" skips archived.

const SESSION_FILE_ACTIVE = 'session.json';
const SESSION_FILE_ARCHIVED = 'session_archived.json';

function sessionFilename(archived: boolean): string {
  return archived ? SESSION_FILE_ARCHIVED : SESSION_FILE_ACTIVE;
}

// ─── Module State ─────────────────────────────────────────────────────────────

let _memDb: Database | null = null;
const _pending = new Map<string, SessionFileShape>(); // sessionId → buffered before dir exists

// ─── Schema ───────────────────────────────────────────────────────────────────

const CREATE_SESSIONS_TABLE = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    meta_json TEXT NOT NULL DEFAULT '{}',
    agent_type TEXT NOT NULL,
    name TEXT,
    external_session_id TEXT,
    pid INTEGER,
    state TEXT NOT NULL DEFAULT 'starting',
    config_options TEXT,
    available_commands TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    archived INTEGER NOT NULL DEFAULT 0,
    ended_at TEXT,
    exit_code INTEGER,
    usage_json TEXT,
    last_message TEXT
  )
`;

// ─── Public: Init ─────────────────────────────────────────────────────────────

/**
 * Scan sessions/{id}/session.json, populate in-memory SQLite, register sessionDirs.
 * Must be called once at startup before any session functions are used.
 */
export function buildSessionDb(agemonDir: string): Database {
  _memDb = new Database(':memory:');
  _memDb.run('PRAGMA journal_mode = WAL');
  _memDb.run(CREATE_SESSIONS_TABLE);
  _memDb.run('CREATE INDEX idx_sessions_state ON sessions(state)');
  _memDb.run("CREATE INDEX idx_sessions_meta_task ON sessions(json_extract(meta_json, '$.task_id'))");

  const sessionsDir = join(agemonDir, 'sessions');
  if (!existsSync(sessionsDir)) return _memDb;

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return _memDb;
  }

  let loaded = 0;
  for (const entry of entries) {
    const dirPath = join(sessionsDir, entry);
    // Check active filename first, then archived
    let sessionJsonPath = join(dirPath, SESSION_FILE_ACTIVE);
    if (!existsSync(sessionJsonPath)) {
      sessionJsonPath = join(dirPath, SESSION_FILE_ARCHIVED);
      if (!existsSync(sessionJsonPath)) continue;
    }

    try {
      const raw = readFileSync(sessionJsonPath, 'utf8');
      const data: SessionFileShape = JSON.parse(raw);

      _memDb.run(
        `INSERT OR REPLACE INTO sessions
          (id, meta_json, agent_type, name, external_session_id, pid, state,
           config_options, available_commands, started_at, archived,
           ended_at, exit_code, usage_json, last_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.id, data.metaJson ?? '{}', data.agentType,
          data.name ?? null, data.externalSessionId ?? null,
          data.pid ?? null, data.state,
          data.configOptions ?? null, data.availableCommands ?? null,
          data.startedAt, data.archived ? 1 : 0,
          data.endedAt ?? null, data.exitCode ?? null,
          data.usageJson ?? null, data.lastMessage ?? null,
        ]
      );

      sessionDirs.set(data.id, dirPath);
      loaded++;
    } catch (err) {
      console.warn(`[session-store] failed to load ${sessionJsonPath}:`, (err as Error).message);
    }
  }

  console.info(`[session-store] loaded ${loaded} session(s) from filesystem`);
  return _memDb;
}

export function getSessionDb(): Database {
  if (!_memDb) throw new Error('[session-store] in-memory DB not initialized — call buildSessionDb() first');
  return _memDb;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function rowToFileShape(row: Record<string, unknown>): SessionFileShape {
  return {
    id: row.id as string,
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
}

function flushSessionJson(sessionId: string): void {
  const dir = sessionDirs.get(sessionId);
  if (!dir) return; // Not yet flushed; will be written when writeSessionJson() is called
  const db = getSessionDb();
  const row = db.query<Record<string, unknown>, [string]>('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return;
  const archived = !!(row.archived as number);
  const targetFile = join(dir, sessionFilename(archived));
  const staleFile = join(dir, sessionFilename(!archived));
  atomicWriteJsonSync(targetFile, rowToFileShape(row));
  if (existsSync(staleFile)) unlinkSync(staleFile);
}

// ─── Public: Called from event-log.ts after dir is created ───────────────────

/**
 * Flush a pending session to disk once the session log dir has been created.
 * Called by initSessionLog() after mkdir succeeds.
 */
export function writeSessionJson(sessionId: string, dir: string): void {
  const db = getSessionDb();
  const row = db.query<Record<string, unknown>, [string]>('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return;
  const archived = !!(row.archived as number);
  atomicWriteJsonSync(join(dir, sessionFilename(archived)), rowToFileShape(row));
  _pending.delete(sessionId);
}

// ─── Public: Session CRUD (same signatures as db/sessions.ts) ────────────────

export function getSession(id: string): AgentSession | null {
  const db = getSessionDb();
  const row = db.query<AgentSession, [string]>('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? parseSession(row) : null;
}

export function listSessions(taskId: string, includeArchived = false): AgentSession[] {
  const db = getSessionDb();
  const archiveFilter = includeArchived ? '' : 'AND archived = 0';
  return db.query<AgentSession, [string]>(
    `SELECT * FROM sessions WHERE json_extract(meta_json, '$.task_id') = ? ${archiveFilter} ORDER BY started_at ASC`
  ).all(taskId).map(parseSession);
}

export function listSessionsByState(state: AgentSessionState): AgentSession[] {
  const db = getSessionDb();
  return db.query<AgentSession, [string]>(
    'SELECT * FROM sessions WHERE state = ? ORDER BY started_at ASC'
  ).all(state).map(parseSession);
}

export function insertSession(session: Pick<AgentSession, 'id' | 'agent_type' | 'pid'> & { meta_json: string }): AgentSession {
  const db = getSessionDb();
  db.run(
    'INSERT INTO sessions (id, meta_json, agent_type, pid) VALUES (?, ?, ?, ?)',
    [session.id, session.meta_json, session.agent_type, session.pid ?? null]
  );
  const row = db.query<AgentSession, [string]>('SELECT * FROM sessions WHERE id = ?').get(session.id);
  if (!row) throw new Error(`[session-store] failed to retrieve newly inserted session ${session.id}`);
  const parsed = parseSession(row);
  _pending.set(session.id, rowToFileShape(row as unknown as Record<string, unknown>));
  return parsed;
}

export function updateSessionState(
  id: string,
  state: AgentSessionState,
  extra?: { external_session_id?: string; pid?: number | null; exit_code?: number | null }
): AgentSession | null {
  const db = getSessionDb();
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
    sets.push('ended_at = ?');
    values.push(new Date().toISOString());
  }

  values.push(id);
  db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, values);

  const row = db.query<AgentSession, [string]>('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  const parsed = parseSession(row);
  flushSessionJson(id);
  return parsed;
}

export function updateSessionName(id: string, name: string): void {
  const db = getSessionDb();
  db.run('UPDATE sessions SET name = ? WHERE id = ?', [name, id]);
  flushSessionJson(id);
}

export function updateSessionLastMessage(id: string, lastMessage: string): void {
  const db = getSessionDb();
  db.run('UPDATE sessions SET last_message = ? WHERE id = ?', [lastMessage, id]);
  flushSessionJson(id);
}

export function updateSessionArchived(id: string, archived: boolean): AgentSession | null {
  const db = getSessionDb();
  db.run('UPDATE sessions SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
  const row = db.query<AgentSession, [string]>('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  const parsed = parseSession(row);
  flushSessionJson(id);
  return parsed;
}

export function archiveSessionsByTask(taskId: string, archived: boolean): void {
  const db = getSessionDb();
  db.run(
    "UPDATE sessions SET archived = ? WHERE json_extract(meta_json, '$.task_id') = ?",
    [archived ? 1 : 0, taskId]
  );
  // Flush all sessions for this task
  const rows = db.query<{ id: string }, [string]>(
    "SELECT id FROM sessions WHERE json_extract(meta_json, '$.task_id') = ?"
  ).all(taskId);
  for (const row of rows) flushSessionJson(row.id);
}

export function updateSessionUsage(id: string, usage: SessionUsage): void {
  const db = getSessionDb();
  db.run('UPDATE sessions SET usage_json = ? WHERE id = ?', [JSON.stringify(usage), id]);
  flushSessionJson(id);
}

export function updateSessionConfigOptions(id: string, options: SessionConfigOption[]): void {
  const db = getSessionDb();
  db.run('UPDATE sessions SET config_options = ? WHERE id = ?', [JSON.stringify(options), id]);
  flushSessionJson(id);
}

export function getSessionConfigOptions(id: string): SessionConfigOption[] | null {
  const db = getSessionDb();
  const row = db.query<{ config_options: string | null }, [string]>(
    'SELECT config_options FROM sessions WHERE id = ?'
  ).get(id);
  if (!row?.config_options) return null;
  try { return JSON.parse(row.config_options); } catch { return null; }
}

export function updateSessionAvailableCommands(id: string, commands: AgentCommand[]): void {
  const db = getSessionDb();
  db.run('UPDATE sessions SET available_commands = ? WHERE id = ?', [JSON.stringify(commands), id]);
  flushSessionJson(id);
}

export function getSessionAvailableCommands(id: string): AgentCommand[] | null {
  const db = getSessionDb();
  const row = db.query<{ available_commands: string | null }, [string]>(
    'SELECT available_commands FROM sessions WHERE id = ?'
  ).get(id);
  if (!row?.available_commands) return null;
  try { return JSON.parse(row.available_commands); } catch { return null; }
}

export function listActiveSessions(): AgentSession[] {
  const db = getSessionDb();
  return db.query<AgentSession, []>(
    "SELECT * FROM sessions WHERE state IN ('running', 'ready', 'starting') AND archived = 0 ORDER BY started_at DESC"
  ).all().map(parseSession);
}

export function listAllSessions(limit: number, includeArchived = false): AgentSession[] {
  const db = getSessionDb();
  const where = includeArchived ? '' : 'WHERE archived = 0';
  return db.query<AgentSession, [number]>(
    `SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ?`
  ).all(limit).map(parseSession);
}

import { getDb } from './client.ts';
import { parseSession, TERMINAL_STATES } from './helpers.ts';
import type { AgentSession, AgentSessionState, SessionConfigOption, SessionUsage, AgentCommand } from '@agemon/shared';

export function getSession(id: string): AgentSession | null {
  const db = getDb();
  const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(id);
  return row ? parseSession(row) : null;
}

export function listSessions(taskId: string, includeArchived = false): AgentSession[] {
  const db = getDb();
  const archiveFilter = includeArchived ? '' : 'AND archived = 0';
  return db.query<AgentSession, [string]>(
    `SELECT * FROM agent_sessions WHERE task_id = ? ${archiveFilter} ORDER BY started_at ASC`
  ).all(taskId).map(parseSession);
}

export function listSessionsByState(state: AgentSessionState): AgentSession[] {
  const db = getDb();
  return db.query<AgentSession, [string]>(
    'SELECT * FROM agent_sessions WHERE state = ? ORDER BY started_at ASC'
  ).all(state).map(parseSession);
}

export function insertSession(session: Pick<AgentSession, 'id' | 'task_id' | 'agent_type' | 'pid'>): AgentSession {
  const db = getDb();
  db.run(
    'INSERT INTO agent_sessions (id, task_id, agent_type, pid) VALUES (?, ?, ?, ?)',
    [session.id, session.task_id, session.agent_type, session.pid ?? null]
  );
  const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(session.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted session with id ${session.id}`);
  return parseSession(row);
}

export function updateSessionState(
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
}

export function updateSessionName(id: string, name: string): void {
  const db = getDb();
  db.run('UPDATE agent_sessions SET name = ? WHERE id = ?', [name, id]);
}

export function updateSessionArchived(id: string, archived: boolean): AgentSession | null {
  const db = getDb();
  db.run('UPDATE agent_sessions SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
  const row = db.query<AgentSession, [string]>('SELECT * FROM agent_sessions WHERE id = ?').get(id);
  return row ? parseSession(row) : null;
}

export function updateSessionUsage(id: string, usage: SessionUsage): void {
  const db = getDb();
  db.run('UPDATE agent_sessions SET usage_json = ? WHERE id = ?', [JSON.stringify(usage), id]);
}

export function updateSessionConfigOptions(id: string, options: SessionConfigOption[]): void {
  const db = getDb();
  db.run('UPDATE agent_sessions SET config_options = ? WHERE id = ?', [JSON.stringify(options), id]);
}

export function getSessionConfigOptions(id: string): SessionConfigOption[] | null {
  const db = getDb();
  const row = db.query<{ config_options: string | null }, [string]>(
    'SELECT config_options FROM agent_sessions WHERE id = ?'
  ).get(id);
  if (!row?.config_options) return null;
  try { return JSON.parse(row.config_options); } catch { return null; }
}

export function updateSessionAvailableCommands(id: string, commands: AgentCommand[]): void {
  const db = getDb();
  db.run('UPDATE agent_sessions SET available_commands = ? WHERE id = ?', [JSON.stringify(commands), id]);
}

export function getSessionAvailableCommands(id: string): AgentCommand[] | null {
  const db = getDb();
  const row = db.query<{ available_commands: string | null }, [string]>(
    'SELECT available_commands FROM agent_sessions WHERE id = ?'
  ).get(id);
  if (!row?.available_commands) return null;
  try { return JSON.parse(row.available_commands); } catch { return null; }
}

export function listAllSessions(limit: number, includeArchived = false): AgentSession[] {
  const database = getDb();
  const where = includeArchived ? '' : 'WHERE archived = 0';
  return database.query<AgentSession, [number]>(
    `SELECT * FROM agent_sessions ${where} ORDER BY started_at DESC LIMIT ?`
  ).all(limit).map(parseSession);
}

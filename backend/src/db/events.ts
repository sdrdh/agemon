import { getDb } from './client.ts';
import type { ACPEvent, ChatMessage } from '@agemon/shared';

export function listEvents(taskId: string, limit: number): ACPEvent[] {
  const db = getDb();
  return db.query<ACPEvent, [string, number]>(
    'SELECT * FROM acp_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(taskId, limit);
}

export function insertEvent(event: Omit<ACPEvent, 'created_at'>): ACPEvent {
  const db = getDb();
  db.run(
    'INSERT INTO acp_events (id, task_id, session_id, type, content) VALUES (?, ?, ?, ?, ?)',
    [event.id, event.task_id, event.session_id, event.type, event.content]
  );
  const row = db.query<ACPEvent, [string]>('SELECT * FROM acp_events WHERE id = ?').get(event.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted event with id ${event.id}`);
  return row;
}

export function listChatHistory(taskId: string, limit: number): ChatMessage[] {
  const database = getDb();

  interface RawChatRow {
    id: string;
    role: string;
    content: string;
    event_type: string;
    timestamp: string;
  }

  const rows = database.query<RawChatRow, [string, string, number]>(`
    SELECT id, 'agent' as role, content, type as event_type, created_at as timestamp
      FROM acp_events WHERE task_id = ?
    UNION ALL
    SELECT id, 'user' as role, response as content, 'input_response' as event_type, created_at as timestamp
      FROM awaiting_input WHERE task_id = ? AND status = 'answered'
    ORDER BY timestamp ASC LIMIT ?
  `).all(taskId, taskId, limit);

  const eventTypeMap: Record<string, ChatMessage['eventType']> = {
    thought: 'thought',
    action: 'action',
    await_input: 'input_request',
    result: 'action',
    prompt: 'prompt',
    input_response: 'input_response',
  };

  return rows.map((row): ChatMessage => ({
    id: row.id,
    role: row.role === 'user' ? 'user' : (row.event_type === 'prompt' ? 'user' : 'agent'),
    content: row.content ?? '',
    eventType: eventTypeMap[row.event_type] ?? 'thought',
    timestamp: row.timestamp,
  }));
}

export function listChatHistoryBySession(sessionId: string, limit: number): ChatMessage[] {
  const database = getDb();

  interface RawChatRow {
    id: string;
    role: string;
    content: string;
    event_type: string;
    timestamp: string;
  }

  const rows = database.query<RawChatRow, [string, string, string, number]>(`
    SELECT id, 'agent' as role, content, type as event_type, created_at as timestamp
      FROM acp_events WHERE session_id = ?
    UNION ALL
    SELECT id, 'user' as role, response as content, 'input_response' as event_type, created_at as timestamp
      FROM awaiting_input WHERE session_id = ? AND status = 'answered'
    UNION ALL
    SELECT id, 'system' as role, id || ':' || status || ':' || tool_name as content, 'approval_request' as event_type, created_at as timestamp
      FROM pending_approvals WHERE session_id = ?
    ORDER BY timestamp ASC LIMIT ?
  `).all(sessionId, sessionId, sessionId, limit);

  const eventTypeMap: Record<string, ChatMessage['eventType']> = {
    thought: 'thought',
    action: 'action',
    await_input: 'input_request',
    result: 'action',
    prompt: 'prompt',
    input_response: 'input_response',
    approval_request: 'approval_request',
  };

  return rows.map((row): ChatMessage => ({
    id: row.event_type === 'approval_request' ? `approval-${row.id}` : row.id,
    role: row.role === 'user' ? 'user' : (row.event_type === 'prompt' ? 'user' : row.role as 'agent' | 'system'),
    content: row.content ?? '',
    eventType: eventTypeMap[row.event_type] ?? 'thought',
    timestamp: row.timestamp,
  }));
}

import { getDb } from './client.ts';
import type { AwaitingInput } from '@agemon/shared';

export function listPendingInputs(taskId: string): AwaitingInput[] {
  const db = getDb();
  return db.query<AwaitingInput, [string]>(
    "SELECT * FROM awaiting_input WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC"
  ).all(taskId);
}

export function insertAwaitingInput(input: Omit<AwaitingInput, 'created_at' | 'response' | 'status'> & { task_id?: string | null }): AwaitingInput {
  const db = getDb();
  db.run(
    'INSERT INTO awaiting_input (id, task_id, session_id, question) VALUES (?, ?, ?, ?)',
    [input.id, input.task_id ?? null, input.session_id, input.question]
  );
  const row = db.query<AwaitingInput, [string]>('SELECT * FROM awaiting_input WHERE id = ?').get(input.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted awaiting_input with id ${input.id}`);
  return row;
}

export function listAllPendingInputs(): AwaitingInput[] {
  const db = getDb();
  return db.query<AwaitingInput, []>(
    "SELECT * FROM awaiting_input WHERE status = 'pending' ORDER BY created_at DESC"
  ).all();
}

export function answerInput(id: string, response: string): AwaitingInput | null {
  const db = getDb();
  db.run("UPDATE awaiting_input SET status = 'answered', response = ? WHERE id = ?", [response, id]);
  return db.query<AwaitingInput, [string]>('SELECT * FROM awaiting_input WHERE id = ?').get(id) ?? null;
}

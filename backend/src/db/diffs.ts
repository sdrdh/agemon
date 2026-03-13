import { getDb } from './client.ts';
import type { Diff } from '@agemon/shared';

export function getDiff(id: string): Diff | null {
  const db = getDb();
  return db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(id) ?? null;
}

export function getPendingDiff(taskId: string): Diff | null {
  const db = getDb();
  return db.query<Diff, [string]>(
    "SELECT * FROM diffs WHERE task_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
  ).get(taskId) ?? null;
}

export function insertDiff(diff: Omit<Diff, 'created_at' | 'status'>): Diff {
  const db = getDb();
  db.run('INSERT INTO diffs (id, task_id, content) VALUES (?, ?, ?)', [diff.id, diff.task_id, diff.content]);
  const row = db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(diff.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted diff with id ${diff.id}`);
  return row;
}

export function updateDiffStatus(id: string, status: 'approved' | 'rejected'): Diff | null {
  const db = getDb();
  db.run('UPDATE diffs SET status = ? WHERE id = ?', [status, id]);
  return db.query<Diff, [string]>('SELECT * FROM diffs WHERE id = ?').get(id) ?? null;
}

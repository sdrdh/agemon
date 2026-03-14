import { getDb } from './client.ts';

export function getSetting(key: string): string | null {
  const row = getDb().query<{ value: string }, [string]>(
    'SELECT value FROM settings WHERE key = ?'
  ).get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().query<{ key: string; value: string }, []>(
    'SELECT key, value FROM settings'
  ).all();
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

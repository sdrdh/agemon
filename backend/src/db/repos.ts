// Repos are backed by task-store's in-memory SQLite.
// Global listRepos scans across all tasks.
export {
  listRepos,
  getTaskRepos,
  setTaskRepos,
  buildRepoMap as _buildRepoMap,
} from '../lib/task-store.ts';

// upsertRepo is a no-op pass-through — repos are auto-created by setTaskRepos.
// Kept for API compatibility.
import { getTaskDb } from '../lib/task-store.ts';
import { parseRepoName } from './helpers.ts';
import type { Repo } from '@agemon/shared';

export function upsertRepo(url: string): Repo {
  const db = getTaskDb();
  const name = parseRepoName(url);
  db.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [url, name]);
  const row = db.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url);
  if (!row) throw new Error(`[repos] failed to upsert repo with url ${url}`);
  return row;
}

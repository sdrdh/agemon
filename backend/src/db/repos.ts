import { getDb } from './client.ts';
import { parseRepoName } from './helpers.ts';
import type { Repo } from '@agemon/shared';
import {
  getTaskRepos as _storeGetTaskRepos,
  setTaskRepos as _storeSetTaskRepos,
  buildRepoMap as _storeBuildRepoMap,
} from '../lib/task-store.ts';

// ─── Global repo registry (persistent SQLite) ─────────────────────────────────
// Used for the repo selector UI and autocompletion.

export function listRepos(): Repo[] {
  const database = getDb();
  return database.query<Repo, []>('SELECT * FROM repos ORDER BY name').all();
}

export function upsertRepo(url: string): Repo {
  const database = getDb();
  const name = parseRepoName(url);
  database.run('INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)', [url, name]);
  const row = database.query<Repo, [string]>('SELECT * FROM repos WHERE url = ?').get(url);
  if (!row) throw new Error(`[db] failed to upsert repo with url ${url}`);
  return row;
}

// ─── Task-scoped repo operations (in-memory task DB) ─────────────────────────
// Delegate to task-store; also sync to global registry so listRepos() is complete.

export function getTaskRepos(taskId: string): Repo[] {
  return _storeGetTaskRepos(taskId);
}

export function setTaskRepos(taskId: string, repoUrls: string[]): Repo[] {
  // Sync each URL to the global persistent repo registry for the selector UI
  for (const url of repoUrls) {
    try { upsertRepo(url); } catch { /* non-fatal */ }
  }
  return _storeSetTaskRepos(taskId, repoUrls);
}

export function _buildRepoMap(taskIds: string[]): Map<string, Repo[]> {
  return _storeBuildRepoMap(taskIds);
}

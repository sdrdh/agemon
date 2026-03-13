import { getDb } from './client.ts';
import { parseRepoName } from './helpers.ts';
import type { Repo } from '@agemon/shared';

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

export function getTaskRepos(taskId: string): Repo[] {
  const database = getDb();
  return database.query<Repo, [string]>(
    `SELECT r.* FROM repos r
     JOIN task_repos tr ON tr.repo_id = r.id
     WHERE tr.task_id = ?
     ORDER BY r.name`
  ).all(taskId);
}

export function setTaskRepos(taskId: string, repoUrls: string[]): Repo[] {
  const database = getDb();
  const repos: Repo[] = [];
  database.transaction(() => {
    database.run('DELETE FROM task_repos WHERE task_id = ?', [taskId]);
    for (const url of repoUrls) {
      const repo = upsertRepo(url);
      database.run(
        'INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)',
        [taskId, repo.id]
      );
      repos.push(repo);
    }
  })();
  return repos;
}

/** Batch-fetch repos for multiple tasks in 2 queries (avoids N+1). */
export function _buildRepoMap(taskIds: string[]): Map<string, Repo[]> {
  const map = new Map<string, Repo[]>();
  if (taskIds.length === 0) return map;

  const database = getDb();
  interface TaskRepoLink { task_id: string; repo_id: number; url: string; name: string; created_at: string }
  const placeholders = taskIds.map(() => '?').join(',');
  const links = database.query<TaskRepoLink, string[]>(
    `SELECT tr.task_id, r.id as repo_id, r.url, r.name, r.created_at
     FROM task_repos tr
     JOIN repos r ON r.id = tr.repo_id
     WHERE tr.task_id IN (${placeholders})
     ORDER BY r.name`
  ).all(...taskIds);

  for (const link of links) {
    let repos = map.get(link.task_id);
    if (!repos) { repos = []; map.set(link.task_id, repos); }
    repos.push({ id: link.repo_id, url: link.url, name: link.name, created_at: link.created_at });
  }
  return map;
}

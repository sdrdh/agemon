import { getDb } from './client.ts';
import { parseTask, type RawTask } from './helpers.ts';
import type { Task, TaskStatus, AgentType, Repo, TasksByProject } from '@agemon/shared';
import { upsertRepo, _buildRepoMap, getTaskRepos, setTaskRepos } from './repos.ts';

export function listTasks(includeArchived = false): Task[] {
  const database = getDb();
  const where = includeArchived ? '' : 'WHERE archived = 0';
  const rows = database.query<RawTask, []>(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all();
  const repoMap = _buildRepoMap(rows.map(r => r.id));
  return rows.map(row => ({
    ...parseTask(row),
    repos: repoMap.get(row.id) ?? [],
  }));
}

export function getTask(id: string): Task | null {
  const database = getDb();
  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return { ...parseTask(row), repos: getTaskRepos(id) };
}

export function createTask(task: { id: string; title: string; description: string | null; status: TaskStatus; agent: AgentType; repos?: string[] }): Task {
  const database = getDb();
  let repos: Repo[] = [];
  database.transaction(() => {
    database.run(
      'INSERT INTO tasks (id, title, description, status, agent) VALUES (?, ?, ?, ?, ?)',
      [task.id, task.title, task.description ?? null, task.status, task.agent]
    );
    if (task.repos) repos = setTaskRepos(task.id, task.repos);
  })();
  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(task.id);
  if (!row) throw new Error(`[db] failed to retrieve newly inserted task with id ${task.id}`);
  return { ...parseTask(row), repos };
}

export function updateTask(id: string, fields: { title?: string; description?: string | null; status?: TaskStatus; agent?: AgentType; repos?: string[]; archived?: boolean }): Task | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
  if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
  if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
  if (fields.agent !== undefined) { sets.push('agent = ?'); values.push(fields.agent); }
  if (fields.archived !== undefined) { sets.push('archived = ?'); values.push(fields.archived ? 1 : 0); }

  const database = getDb();

  database.transaction(() => {
    if (sets.length > 0) {
      values.push(id);
      database.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
    }
    if (fields.repos !== undefined) {
      setTaskRepos(id, fields.repos);
    }
  })();

  const row = database.query<RawTask, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return { ...parseTask(row), repos: getTaskRepos(id) };
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.run('DELETE FROM tasks WHERE id = ?', [id]);
  return result.changes > 0;
}

export function listTasksByProject(includeArchived = false): TasksByProject {
  const database = getDb();
  const archiveFilter = includeArchived ? '' : 'AND t.archived = 0';

  interface TaskRepoRow extends RawTask {
    repo_url: string;
    repo_name: string;
  }
  const taskRepoRows = database.query<TaskRepoRow, []>(`
    SELECT t.*, r.url as repo_url, r.name as repo_name
    FROM tasks t
    JOIN task_repos tr ON tr.task_id = t.id
    JOIN repos r ON r.id = tr.repo_id
    WHERE 1=1 ${archiveFilter}
    ORDER BY r.name, t.created_at DESC
  `).all();

  const ungroupedRows = database.query<RawTask, []>(`
    SELECT t.* FROM tasks t
    WHERE t.id NOT IN (SELECT task_id FROM task_repos)
    ${archiveFilter}
    ORDER BY t.created_at DESC
  `).all();

  const allTaskIds = new Set<string>();
  for (const row of taskRepoRows) allTaskIds.add(row.id);
  for (const row of ungroupedRows) allTaskIds.add(row.id);
  const repoCache = _buildRepoMap([...allTaskIds]);

  const projects: Record<string, Task[]> = {};
  const seenPerProject = new Map<string, Set<string>>();

  for (const row of taskRepoRows) {
    const repoName = row.repo_name;
    if (!projects[repoName]) {
      projects[repoName] = [];
      seenPerProject.set(repoName, new Set());
    }
    const seen = seenPerProject.get(repoName)!;
    if (!seen.has(row.id)) {
      seen.add(row.id);
      projects[repoName].push({
        ...parseTask(row),
        repos: repoCache.get(row.id) ?? [],
      });
    }
  }

  const ungrouped: Task[] = ungroupedRows.map(row => ({
    ...parseTask(row),
    repos: [],
  }));

  return { projects, ungrouped };
}

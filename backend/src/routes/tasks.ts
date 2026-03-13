import { Hono } from 'hono';
import { db, generateTaskId } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { getActiveSession, stopAgent } from '../lib/acp/index.ts';
import { gitManager } from '../lib/git.ts';
import { refreshTaskContext } from '../lib/context.ts';
import { sendError, validateTaskFields, validateRepoUrls, requireTask, VALID_TASK_STATUSES } from './shared.ts';
import type { CreateTaskBody, UpdateTaskBody } from '@agemon/shared';

export const tasksRoutes = new Hono();

// ── Task CRUD ────────────────────────────────────────────────────────────────

tasksRoutes.get('/tasks', (c) => {
  const includeArchived = c.req.query('archived') === 'true';
  return c.json(db.listTasks(includeArchived));
});

tasksRoutes.post('/tasks', async (c) => {
  let body: CreateTaskBody;
  try {
    body = await c.req.json<CreateTaskBody>();
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }
  const { title: rawTitle, description, repos, agent } = body;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : rawTitle;

  if (!title || typeof title !== 'string') {
    sendError(400, 'title is required');
  }

  const repoUrls = repos ?? [];
  validateRepoUrls(repoUrls);

  const agentType = agent ?? 'claude-code';
  validateTaskFields({ title, description, agent: agentType });

  const task = db.createTask({
    id: generateTaskId(title),
    title,
    description: description ?? null,
    status: 'todo',
    agent: agentType,
    repos: repoUrls,
  });

  // Create worktrees + context for any repos attached at creation
  if (repoUrls.length > 0) {
    (async () => {
      for (const repo of task.repos) {
        try {
          await gitManager.createWorktree(task.id, repo.url);
        } catch (err) {
          console.warn(`[context] failed to create worktree for ${repo.name}:`, (err as Error).message);
        }
      }
      await refreshTaskContext(task);
    })().catch((err) => {
      console.warn(`[context] failed to set up context for task ${task.id}:`, err);
    });
  }

  broadcast({ type: 'task_updated', task });
  return c.json(task, 201);
});

// IMPORTANT: /tasks/by-project MUST be before /tasks/:id to avoid Hono matching "by-project" as an :id
tasksRoutes.get('/tasks/by-project', (c) => {
  const includeArchived = c.req.query('archived') === 'true';
  return c.json(db.listTasksByProject(includeArchived));
});

tasksRoutes.get('/tasks/:id', (c) => {
  const task = requireTask(c.req.param('id'));
  return c.json(task);
});

tasksRoutes.patch('/tasks/:id', async (c) => {
  const task = requireTask(c.req.param('id'));

  let body: UpdateTaskBody;
  try {
    body = await c.req.json<UpdateTaskBody>();
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }

  const { title, description, agent, repos, status, archived } = body;
  validateTaskFields({ title, description, agent });

  if (status !== undefined && !VALID_TASK_STATUSES.has(status)) {
    sendError(400, `status must be one of: ${[...VALID_TASK_STATUSES].join(', ')}`);
  }

  if (repos !== undefined) {
    validateRepoUrls(repos);
  }

  if (archived !== undefined && typeof archived !== 'boolean') {
    sendError(400, 'archived must be a boolean');
  }

  // Handle "mark done" — clean up worktrees
  if (status === 'done' && task.status !== 'done') {
    // Stop any active sessions first
    const active = getActiveSession(task.id);
    if (active) {
      try { stopAgent(active.id); } catch { /* already stopping */ }
    }
    // Clean up worktrees
    await gitManager.deleteTaskWorktrees(task.id).catch((err) => {
      console.warn(`[routes] failed to clean worktrees for task ${task.id}:`, err);
    });
  }

  const updated = db.updateTask(task.id, { title, description, agent, repos, status, archived });
  if (!updated) return c.json({ error: 'Not Found', message: 'Task not found', statusCode: 404 }, 404);

  // When repos change: create worktrees + refresh context (CLAUDE.md, symlinks)
  if (repos !== undefined) {
    (async () => {
      for (const repo of updated.repos) {
        try {
          await gitManager.createWorktree(updated.id, repo.url);
        } catch (err) {
          console.warn(`[context] failed to create worktree for ${repo.name}:`, (err as Error).message);
        }
      }
      await refreshTaskContext(updated);
    })().catch((err) => {
      console.warn(`[context] failed to refresh context for task ${updated.id}:`, err);
    });
  }

  broadcast({ type: 'task_updated', task: updated });
  return c.json(updated);
});

tasksRoutes.delete('/tasks/:id', (c) => {
  const id = c.req.param('id');
  const task = db.getTask(id);
  if (!task) sendError(404, 'Task not found');

  // Stop any running agent before deleting
  const active = getActiveSession(id);
  if (active) {
    try { stopAgent(active.id); } catch { /* already stopping */ }
  }

  db.deleteTask(id);
  broadcast({ type: 'task_updated', task: { ...task!, status: 'done' } });
  return new Response(null, { status: 204 });
});

tasksRoutes.get('/tasks/:id/events', (c) => {
  const task = requireTask(c.req.param('id'));
  const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 1000 ? 500 : limitParam;
  const events = db.listEvents(task.id, limit);
  return c.json(events);
});

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { randomUUID } from 'crypto';
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { spawnAgent, stopAgent, getRunningSession } from '../lib/acp.ts';
import { gitManager } from '../lib/git.ts';
import type { CreateTaskBody, UpdateTaskBody, AgentType, Task } from '@agemon/shared';
import { AGENT_TYPES, SSH_REPO_REGEX } from '@agemon/shared';

function sendError(statusCode: number, message: string): never {
  throw new HTTPException(statusCode as ContentfulStatusCode, { message });
}

function validateTaskFields(fields: { title?: string; description?: string | null; agent?: AgentType }): void {
  if (fields.agent !== undefined && !(AGENT_TYPES as readonly string[]).includes(fields.agent))
    sendError(400, `agent must be one of: ${[...AGENT_TYPES].join(', ')}`);
  if (fields.title !== undefined && fields.title.length > 500)
    sendError(400, 'title must be 500 characters or fewer');
  if (fields.description !== undefined && fields.description !== null && fields.description.length > 10000)
    sendError(400, 'description must be 10000 characters or fewer');
}

function validateRepoUrls(repos: unknown): asserts repos is string[] {
  if (!Array.isArray(repos)) sendError(400, 'repos must be an array');
  if (repos.length > 20) sendError(400, 'repos must contain 20 or fewer entries');
  if (!repos.every(r => typeof r === 'string' && SSH_REPO_REGEX.test(r)))
    sendError(400, 'each repo must be a valid SSH URL (git@host:org/repo.git)');
  if (!repos.every(r => r.length <= 500))
    sendError(400, 'each repo URL must be 500 characters or fewer');
}

function requireTask(id: string): Task {
  const task = db.getTask(id);
  if (!task) sendError(404, 'Task not found');
  return task!;
}

export const tasksRoutes = new Hono();

tasksRoutes.get('/tasks', (c) => {
  return c.json(db.listTasks());
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
    id: randomUUID(),
    title,
    description: description ?? null,
    status: 'todo',
    agent: agentType,
    repos: repoUrls,
  });

  broadcast({ type: 'task_updated', task });
  return c.json(task, 201);
});

// IMPORTANT: /tasks/by-project MUST be before /tasks/:id to avoid Hono matching "by-project" as an :id
tasksRoutes.get('/tasks/by-project', (c) => {
  return c.json(db.listTasksByProject());
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

  const { title, description, agent, repos } = body;
  validateTaskFields({ title, description, agent });

  if (repos !== undefined) {
    validateRepoUrls(repos);
  }

  const updated = db.updateTask(task.id, { title, description, agent, repos });
  if (!updated) return c.json({ error: 'Not Found', message: 'Task not found', statusCode: 404 }, 404);
  broadcast({ type: 'task_updated', task: updated });
  return c.json(updated);
});

tasksRoutes.delete('/tasks/:id', (c) => {
  const id = c.req.param('id');
  const task = db.getTask(id);
  if (!task) sendError(404, 'Task not found');

  // Stop any running agent before deleting
  const running = getRunningSession(id);
  if (running) {
    try { stopAgent(running.id); } catch { /* already stopping */ }
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

tasksRoutes.post('/tasks/:id/start', async (c) => {
  const task = requireTask(c.req.param('id'));
  if (task.status !== 'todo') {
    sendError(400, 'Task must be in todo status to start');
  }

  // Create worktrees for each attached repo
  for (const repo of task.repos) {
    try {
      await gitManager.createWorktree(task.id, repo.url);
    } catch (err) {
      await gitManager.deleteTaskWorktrees(task.id).catch(() => {});
      sendError(500, `Failed to create worktree for ${repo.name}: ${(err as Error).message}`);
    }
  }

  try {
    const session = spawnAgent(task.id, task.agent);
    return c.json(session, 202);
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

tasksRoutes.post('/tasks/:id/stop', (c) => {
  const task = requireTask(c.req.param('id'));
  const session = getRunningSession(task.id);
  if (!session) {
    sendError(404, 'No running session found for this task');
  }
  try {
    stopAgent(session!.id);
    return c.json({ message: 'Stop signal sent', sessionId: session!.id });
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

tasksRoutes.get('/tasks/:id/chat', (c) => {
  const task = requireTask(c.req.param('id'));
  const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 5000 ? 500 : limitParam;
  const messages = db.listChatHistory(task.id, limit);
  return c.json(messages);
});

tasksRoutes.get('/sessions', (c) => {
  const limitParam = parseInt(c.req.query('limit') ?? '100', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 1000 ? 100 : limitParam;
  const sessions = db.listAllSessions(limit);
  return c.json(sessions);
});

tasksRoutes.get('/repos', (c) => {
  return c.json(db.listRepos());
});

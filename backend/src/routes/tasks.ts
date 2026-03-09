import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { db, generateTaskId } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { spawnAndHandshake, stopAgent, getActiveSession, resumeSession, setSessionConfigOption, getSessionConfigOptions } from '../lib/acp.ts';
import { gitManager } from '../lib/git.ts';
import { refreshTaskContext } from '../lib/context.ts';
import type { CreateTaskBody, UpdateTaskBody, CreateSessionBody, AgentType, Task, TaskStatus } from '@agemon/shared';
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

const VALID_TASK_STATUSES = new Set<TaskStatus>(['todo', 'working', 'awaiting_input', 'done']);

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

// ── Sessions ─────────────────────────────────────────────────────────────────

/**
 * POST /tasks/:id/sessions — create a new session for a task.
 * Spawns an agent process, runs ACP handshake, returns session in `starting` state.
 * Worktrees are created on first session for the task.
 */
tasksRoutes.post('/tasks/:id/sessions', async (c) => {
  const task = requireTask(c.req.param('id'));

  let body: CreateSessionBody = {};
  try {
    const raw = await c.req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }

  const agentType = body.agentType ?? task.agent;
  if (!(AGENT_TYPES as readonly string[]).includes(agentType)) {
    sendError(400, `agentType must be one of: ${[...AGENT_TYPES].join(', ')}`);
  }

  // Create worktrees if this is the first session for the task (include archived)
  const existingSessions = db.listSessions(task.id, true);
  if (existingSessions.length === 0) {
    for (const repo of task.repos) {
      try {
        await gitManager.createWorktree(task.id, repo.url);
      } catch (err) {
        await gitManager.deleteTaskWorktrees(task.id).catch(() => {});
        sendError(500, `Failed to create worktree for ${repo.name}: ${(err as Error).message}`);
      }
    }
  }

  try {
    const session = spawnAndHandshake(task.id, agentType);
    return c.json(session, 202);
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

/**
 * GET /tasks/:id/sessions — list all sessions for a task.
 */
tasksRoutes.get('/tasks/:id/sessions', (c) => {
  const task = requireTask(c.req.param('id'));
  const includeArchived = c.req.query('archived') === 'true';
  return c.json(db.listSessions(task.id, includeArchived));
});

/**
 * GET /sessions/:id/chat — get chat history for a specific session.
 */
tasksRoutes.get('/sessions/:id/chat', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 5000 ? 500 : limitParam;
  const messages = db.listChatHistoryBySession(sessionId, limit);
  return c.json(messages);
});

/**
 * POST /sessions/:id/stop — stop a specific session.
 */
tasksRoutes.post('/sessions/:id/stop', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');
  if (session!.state !== 'running' && session!.state !== 'ready' && session!.state !== 'starting') {
    sendError(400, `Session is in state ${session!.state}, not stoppable`);
  }
  try {
    stopAgent(sessionId);
    return c.json({ message: 'Stop signal sent', sessionId });
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/resume — resume a stopped/crashed session.
 */
tasksRoutes.post('/sessions/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  try {
    const resumed = await resumeSession(sessionId);
    return c.json(resumed, 202);
  } catch (err) {
    sendError(400, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/config — set a config option on a running session.
 */
tasksRoutes.post('/sessions/:id/config', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  let body: { configId: string; value: string };
  try {
    body = await c.req.json();
  } catch {
    sendError(400, 'Request body must be valid JSON');
  }

  if (!body.configId || typeof body.configId !== 'string') sendError(400, 'configId is required');
  if (!body.value || typeof body.value !== 'string') sendError(400, 'value is required');

  try {
    await setSessionConfigOption(sessionId, body.configId, body.value);
    return c.json({ message: 'Config option set', sessionId, configId: body.configId, value: body.value });
  } catch (err) {
    sendError(400, (err as Error).message);
  }
});

/**
 * GET /sessions/:id/config — get config options for a session.
 */
tasksRoutes.get('/sessions/:id/config', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  const configOptions = getSessionConfigOptions(sessionId);
  return c.json(configOptions);
});

/**
 * PATCH /sessions/:id/archive — archive or unarchive a session.
 */
tasksRoutes.patch('/sessions/:id/archive', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) return sendError(404, 'Session not found');

  let body: { archived: boolean };
  try {
    body = await c.req.json();
  } catch {
    return sendError(400, 'Request body must be valid JSON');
  }

  if (typeof body.archived !== 'boolean') {
    return sendError(400, 'archived must be a boolean');
  }

  const updated = db.updateSessionArchived(sessionId, body.archived);
  if (!updated) return sendError(404, 'Session not found');
  broadcast({ type: 'task_updated', task: db.getTask(updated.task_id)! });
  return c.json(updated);
});

// ── Legacy endpoints (backward compat) ──────────────────────────────────────

tasksRoutes.post('/tasks/:id/stop', (c) => {
  const task = requireTask(c.req.param('id'));
  const session = getActiveSession(task.id);
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

// ── Global session + repo endpoints ──────────────────────────────────────────

tasksRoutes.get('/sessions', (c) => {
  const limitParam = parseInt(c.req.query('limit') ?? '100', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 1000 ? 100 : limitParam;
  const includeArchived = c.req.query('archived') === 'true';
  const sessions = db.listAllSessions(limit, includeArchived);
  return c.json(sessions);
});

tasksRoutes.get('/repos', (c) => {
  return c.json(db.listRepos());
});

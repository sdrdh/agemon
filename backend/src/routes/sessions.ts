import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { spawnAndHandshake, stopAgent, getActiveSession, resumeSession, setSessionConfigOption, getSessionConfigOptions, getSessionAvailableCommands, sendPromptTurn } from '../lib/acp/index.ts';
import { spawnLocalDirSession } from '../lib/acp/spawn.ts';
import { gitManager } from '../lib/git.ts';
import { sendError, requireTask } from './shared.ts';
import type { CreateSessionBody } from '@agemon/shared';
import { AGENT_TYPES } from '@agemon/shared';

export const sessionsRoutes = new Hono();

/**
 * POST /tasks/:id/sessions — create a new session for a task.
 * Spawns an agent process, runs ACP handshake, returns session in `starting` state.
 * Worktrees are created on first session for the task.
 */
sessionsRoutes.post('/tasks/:id/sessions', async (c) => {
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
sessionsRoutes.get('/tasks/:id/sessions', (c) => {
  const task = requireTask(c.req.param('id'));
  const includeArchived = c.req.query('archived') === 'true';
  return c.json(db.listSessions(task.id, includeArchived));
});

/**
 * POST /sessions — create a raw session in a local directory (no task required).
 * Body: { agentType?: string, cwd: string }
 */
sessionsRoutes.post('/sessions', async (c) => {
  let body: { agentType?: string; cwd?: string } = {};
  try {
    const raw = await c.req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    return sendError(400, 'Request body must be valid JSON');
  }

  const agentType = body.agentType ?? 'claude-code';
  if (!(AGENT_TYPES as readonly string[]).includes(agentType)) {
    return sendError(400, `agentType must be one of: ${[...AGENT_TYPES].join(', ')}`);
  }

  if (!body.cwd || typeof body.cwd !== 'string') {
    return sendError(400, 'cwd is required for local-dir sessions');
  }

  try {
    const session = spawnLocalDirSession(body.cwd, agentType as any);
    return c.json(session, 202);
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * GET /sessions/:id — get a single session by ID.
 */
sessionsRoutes.get('/sessions/:id', (c) => {
  const session = db.getSession(c.req.param('id'));
  if (!session) sendError(404, 'Session not found');
  return c.json(session);
});

/**
 * GET /sessions/:id/chat — get chat history for a specific session.
 */
sessionsRoutes.get('/sessions/:id/chat', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 5000 ? 500 : limitParam;
  const before = c.req.query('before') || undefined;
  const messages = db.listChatHistoryBySession(sessionId, limit, before);
  return c.json({ messages, hasMore: messages.length === limit });
});

/**
 * POST /sessions/:id/stop — stop a specific session.
 */
sessionsRoutes.post('/sessions/:id/stop', (c) => {
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
 * POST /sessions/:id/message — send a prompt message to a running session.
 */
sessionsRoutes.post('/sessions/:id/message', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');
  if (session!.state !== 'running' && session!.state !== 'ready') {
    sendError(400, `Session is in state ${session!.state}, not accepting messages`);
  }
  const body = await c.req.json<{ content: string }>();
  if (!body.content || typeof body.content !== 'string') {
    sendError(400, 'content is required');
  }
  try {
    await sendPromptTurn(sessionId, body.content);
    return c.json({ message: 'Message sent', sessionId });
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/resume — resume a stopped/crashed session.
 */
sessionsRoutes.post('/sessions/:id/resume', async (c) => {
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
sessionsRoutes.post('/sessions/:id/config', async (c) => {
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
sessionsRoutes.get('/sessions/:id/config', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  const configOptions = getSessionConfigOptions(sessionId);
  return c.json(configOptions);
});

/**
 * GET /sessions/:id/commands — get available slash commands for a session.
 */
sessionsRoutes.get('/sessions/:id/commands', (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) sendError(404, 'Session not found');

  const commands = getSessionAvailableCommands(sessionId);
  return c.json(commands);
});

/**
 * PATCH /sessions/:id/archive — archive or unarchive a session.
 */
sessionsRoutes.patch('/sessions/:id/archive', async (c) => {
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
  if (updated.task_id) {
    const task = db.getTask(updated.task_id);
    if (task) broadcast({ type: 'task_updated', task });
  }
  return c.json(updated);
});

// ── Legacy endpoints (backward compat) ──────────────────────────────────────

sessionsRoutes.post('/tasks/:id/stop', (c) => {
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

sessionsRoutes.get('/tasks/:id/chat', (c) => {
  const task = requireTask(c.req.param('id'));
  const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 5000 ? 500 : limitParam;
  const before = c.req.query('before') || undefined;
  const messages = db.listChatHistory(task.id, limit, before);
  return c.json({ messages, hasMore: messages.length === limit });
});

// ── Global session + repo endpoints ──────────────────────────────────────────

sessionsRoutes.get('/sessions', (c) => {
  const limitParam = parseInt(c.req.query('limit') ?? '100', 10);
  const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 1000 ? 100 : limitParam;
  const includeArchived = c.req.query('archived') === 'true';
  const sessions = db.listAllSessions(limit, includeArchived);
  return c.json(sessions);
});

sessionsRoutes.get('/repos', (c) => {
  return c.json(db.listRepos());
});

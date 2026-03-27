import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { stopAgent, getActiveSession, resumeSession, setSessionConfigOption, getSessionConfigOptions, getSessionAvailableCommands, sendPromptTurn, cancelTurn, sendInputToAgent } from '../lib/acp/index.ts';
import { spawnLocalDirSession } from '../lib/acp/spawn.ts';
import { sendError, requireTask } from './shared.ts';
import { AGENT_TYPES } from '@agemon/shared';

export const sessionsRoutes = new Hono();

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

/**
 * POST /sessions/:id/messages — send a prompt message to a running session.
 * Body: { content: string }
 */
sessionsRoutes.post('/sessions/:id/messages', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) return sendError(404, 'Session not found');
  let body: { content?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (!body.content || typeof body.content !== 'string') return sendError(400, 'content is required');
  try {
    await sendPromptTurn(sessionId, body.content);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/inputs/:inputId/respond — answer a pending input prompt.
 * Body: { response: string }
 */
sessionsRoutes.post('/sessions/:id/inputs/:inputId/respond', async (c) => {
  const sessionId = c.req.param('id');
  const inputId = c.req.param('inputId');
  let body: { response?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (typeof body.response !== 'string') return sendError(400, 'response is required');

  const input = db.answerInput(inputId, body.response);
  if (!input) return sendError(404, `Unknown inputId: ${inputId}`);

  const sent = sendInputToAgent(sessionId, inputId, body.response);
  if (!sent) console.warn(`[api] send_input: could not relay to agent session ${sessionId}`);

  if (input.task_id) {
    const pending = db.listPendingInputs(input.task_id);
    if (pending.length === 0) {
      db.updateTask(input.task_id, { status: 'working' });
      const task = db.getTask(input.task_id);
      if (task) broadcast({ type: 'task_updated', task });
    }
  }
  return c.json({ ok: true });
});

/**
 * POST /sessions/:id/cancel — cancel the running turn.
 */
sessionsRoutes.post('/sessions/:id/cancel', async (c) => {
  const sessionId = c.req.param('id');
  try {
    cancelTurn(sessionId);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/config — update a session config option (e.g. model, mode).
 * Body: { configId: string; value: string }
 */
sessionsRoutes.post('/sessions/:id/config', async (c) => {
  const sessionId = c.req.param('id');
  let body: { configId?: string; value?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (!body.configId || typeof body.value !== 'string') return sendError(400, 'configId and value are required');
  try {
    await setSessionConfigOption(sessionId, body.configId, body.value);
    return c.json({ ok: true });
  } catch (err) {
    return sendError(500, (err as Error).message);
  }
});

/**
 * POST /sessions/:id/terminal — send raw bytes to a terminal session.
 * Body: { data: string }
 */
sessionsRoutes.post('/sessions/:id/terminal', async (c) => {
  const sessionId = c.req.param('id');
  let body: { data?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  if (typeof body.data !== 'string') return sendError(400, 'data is required');
  const { eventBus } = await import('../server.ts');
  eventBus.emit('ws:client_event', { type: 'terminal_input', sessionId, data: body.data });
  return c.json({ ok: true });
});

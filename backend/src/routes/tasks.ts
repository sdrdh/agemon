import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { StatusCode } from 'hono/utils/http-status';
import { randomUUID } from 'crypto';
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import type { CreateTaskBody, UpdateTaskBody, AgentType, Task } from '@agemon/shared';

const VALID_AGENTS: AgentType[] = ['claude-code', 'aider', 'gemini'];

const isValidRepoUrl = (r: string) =>
  r.startsWith('https://') || r.startsWith('http://') || r.startsWith('git@') || r.startsWith('/');

function sendError(statusCode: number, message: string): never {
  throw new HTTPException(statusCode as StatusCode, { message });
}

function validateTaskFields(fields: { title?: string; description?: string | null; agent?: AgentType }): void {
  if (fields.agent !== undefined && !VALID_AGENTS.includes(fields.agent))
    sendError(400, 'agent must be one of: claude-code, aider, gemini');
  if (fields.title !== undefined && fields.title.length > 500)
    sendError(400, 'title must be 500 characters or fewer');
  if (fields.description !== undefined && fields.description !== null && fields.description.length > 10000)
    sendError(400, 'description must be 10000 characters or fewer');
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
  const body = await c.req.json<CreateTaskBody>();
  const { title, description, repos, agent } = body;

  if (!title || typeof title !== 'string') {
    sendError(400, 'title is required');
  }
  if (!Array.isArray(repos) || repos.length === 0) {
    sendError(400, 'repos must be a non-empty array');
  }
  if (!repos.every(r => typeof r === 'string' && r.length > 0 && isValidRepoUrl(r))) {
    sendError(400, 'each repo must start with https://, http://, git@, or /');
  }
  if (!agent) {
    sendError(400, 'agent is required');
  }
  validateTaskFields({ title, description, agent });

  const task = db.createTask({
    id: randomUUID(),
    title,
    description: description ?? null,
    status: 'todo',
    repos,
    agent,
  });

  broadcast({ type: 'task_updated', task });
  return c.json(task, 201);
});

tasksRoutes.get('/tasks/:id', (c) => {
  const task = requireTask(c.req.param('id'));
  return c.json(task);
});

tasksRoutes.patch('/tasks/:id', async (c) => {
  const task = requireTask(c.req.param('id'));

  const body = await c.req.json<UpdateTaskBody>();
  // Status is system-controlled — strip it from user PATCH requests
  const { title, description, agent } = body;
  validateTaskFields({ title, description, agent });
  const updated = db.updateTask(task.id, { title, description, agent });
  if (updated) broadcast({ type: 'task_updated', task: updated });
  return c.json(updated);
});

tasksRoutes.delete('/tasks/:id', (c) => {
  const deleted = db.deleteTask(c.req.param('id'));
  if (!deleted) sendError(404, 'Task not found');
  return new Response(null, { status: 204 });
});

tasksRoutes.get('/tasks/:id/events', (c) => {
  const task = requireTask(c.req.param('id'));
  return c.json(db.listEvents(task.id));
});

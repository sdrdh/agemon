import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { db } from '../db/client.ts';
import type { CreateMcpServerBody, McpServerConfig } from '@agemon/shared';

function sendError(statusCode: number, message: string): never {
  throw new HTTPException(statusCode as ContentfulStatusCode, { message });
}

function generateId(): string {
  return `mcp-${crypto.randomUUID()}`;
}

function validateMcpServerBody(body: unknown): asserts body is CreateMcpServerBody {
  if (!body || typeof body !== 'object') sendError(400, 'request body required');
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.length === 0) sendError(400, 'name is required');
  if (b.name.length > 200) sendError(400, 'name must be 200 characters or fewer');
  if (!b.config || typeof b.config !== 'object') sendError(400, 'config is required');
  const config = b.config as Record<string, unknown>;

  if (config.type === 'http') {
    if (typeof config.url !== 'string' || config.url.length === 0) sendError(400, 'config.url is required for http transport');
  } else {
    if (typeof config.command !== 'string' || config.command.length === 0) sendError(400, 'config.command is required for stdio transport');
  }

  // Sync config.name with body.name so they can never diverge
  config.name = b.name;
}

export const mcpConfigRoutes = new Hono();

// ── Global MCP Servers ────────────────────────────────────────────────────────

mcpConfigRoutes.get('/mcp-servers', (c) => {
  return c.json(db.listGlobalMcpServers());
});

mcpConfigRoutes.post('/mcp-servers', async (c) => {
  const body = await c.req.json();
  validateMcpServerBody(body);
  const id = generateId();
  try {
    const entry = db.addMcpServer(id, body.name, null, body.config);
    return c.json(entry, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      sendError(409, `global MCP server with name "${body.name}" already exists`);
    }
    throw err;
  }
});

mcpConfigRoutes.delete('/mcp-servers/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.getMcpServer(id);
  if (!existing) sendError(404, 'MCP server not found');
  if (existing.taskId !== null) sendError(400, 'this is a task-level MCP server, use the task endpoint to delete it');
  db.removeMcpServer(id);
  return c.json({ ok: true });
});

// ── Task-level MCP Servers ────────────────────────────────────────────────────

mcpConfigRoutes.get('/tasks/:taskId/mcp-servers', (c) => {
  const taskId = c.req.param('taskId');
  const task = db.getTask(taskId);
  if (!task) sendError(404, 'Task not found');
  const global = db.listGlobalMcpServers();
  const taskLevel = db.listTaskMcpServers(taskId);
  return c.json({ global, task: taskLevel });
});

mcpConfigRoutes.post('/tasks/:taskId/mcp-servers', async (c) => {
  const taskId = c.req.param('taskId');
  const task = db.getTask(taskId);
  if (!task) sendError(404, 'Task not found');
  const body = await c.req.json();
  validateMcpServerBody(body);
  const id = generateId();
  try {
    const entry = db.addMcpServer(id, body.name, taskId, body.config);
    return c.json(entry, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      sendError(409, `MCP server with name "${body.name}" already exists for this task`);
    }
    throw err;
  }
});

mcpConfigRoutes.delete('/tasks/:taskId/mcp-servers/:serverId', (c) => {
  const taskId = c.req.param('taskId');
  const serverId = c.req.param('serverId');
  const existing = db.getMcpServer(serverId);
  if (!existing) sendError(404, 'MCP server not found');
  if (existing.taskId !== taskId) sendError(400, 'MCP server does not belong to this task');
  db.removeMcpServer(serverId);
  return c.json({ ok: true });
});

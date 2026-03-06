import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { db } from '../db/client.ts';
import type { CreateMcpServerBody, McpServerConfig, McpServerStdio, McpServerHttp, TestMcpServerResult, McpToolInfo } from '@agemon/shared';

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
}

/** Ensure config.name matches body.name so they can never diverge. */
function normalizeBody(body: CreateMcpServerBody): CreateMcpServerBody {
  return { ...body, config: { ...body.config, name: body.name } };
}

export const mcpConfigRoutes = new Hono();

// ── Global MCP Servers ────────────────────────────────────────────────────────

mcpConfigRoutes.get('/mcp-servers', (c) => {
  return c.json(db.listGlobalMcpServers());
});

mcpConfigRoutes.post('/mcp-servers', async (c) => {
  const raw = await c.req.json();
  validateMcpServerBody(raw);
  const body = normalizeBody(raw);
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

// ── Test MCP Server Connectivity ──────────────────────────────────────────────

/** POST a JSON-RPC message to an MCP Streamable HTTP endpoint and parse the response. */
async function postJsonRpc(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ json: Record<string, unknown> | null; sessionId?: string }> {
  const reqHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) reqHeaders['Mcp-Session-Id'] = sessionId;

  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  const newSessionId = res.headers.get('Mcp-Session-Id') ?? sessionId;
  const contentType = res.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/json')) {
    return { json: await res.json() as Record<string, unknown>, sessionId: newSessionId };
  }

  // SSE response — extract first JSON-RPC message from the stream
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          return { json: JSON.parse(line.slice(6)) as Record<string, unknown>, sessionId: newSessionId };
        } catch { /* skip non-JSON data lines */ }
      }
    }
    return { json: null, sessionId: newSessionId };
  }

  // Notification accepted (no body expected)
  if (res.status === 202 || res.status === 204) {
    return { json: null, sessionId: newSessionId };
  }

  return { json: null, sessionId: newSessionId };
}

async function testHttpServer(config: McpServerHttp): Promise<TestMcpServerResult> {
  const start = Date.now();
  const hdrs: Record<string, string> = {};
  if (config.headers) {
    for (const h of config.headers) {
      if (h.name.trim()) hdrs[h.name.trim()] = h.value;
    }
  }
  try {
    // 1. Initialize
    const initResult = await postJsonRpc(config.url, hdrs, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agemon-health-check', version: '1.0.0' },
      },
    });

    if (!initResult.json?.result || !(initResult.json.result as Record<string, unknown>).protocolVersion) {
      const latencyMs = Date.now() - start;
      if (initResult.json) {
        return { status: 'connected', message: 'Server responded but not MCP-compatible', latencyMs };
      }
      return { status: 'error', message: 'No response from server', latencyMs };
    }

    const result = initResult.json.result as Record<string, unknown>;
    const serverName = (result.serverInfo as Record<string, unknown>)?.name ?? 'unknown';
    const protocolVersion = result.protocolVersion as string;

    // 2. Send initialized notification
    await postJsonRpc(config.url, hdrs, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, initResult.sessionId);

    // 3. Request tools/list
    const toolsResult = await postJsonRpc(config.url, hdrs, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, initResult.sessionId);

    const latencyMs = Date.now() - start;

    let tools: McpToolInfo[] | undefined;
    if (toolsResult.json?.result) {
      const toolsList = (toolsResult.json.result as Record<string, unknown>).tools;
      if (Array.isArray(toolsList)) {
        tools = toolsList.map((t: Record<string, unknown>) => ({
          name: t.name as string,
          ...(t.description ? { description: t.description as string } : {}),
        }));
      }
    }

    return {
      status: 'connected',
      message: `MCP ${protocolVersion} — ${serverName}`,
      latencyMs,
      tools,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Connection failed', latencyMs: Date.now() - start };
  }
}

/** Read a single JSON-RPC message from the stdout reader with a timeout. */
async function readJsonRpcMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const result = await Promise.race([
    reader.read(),
    new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs),
    ),
  ]);
  if (!result.value) return null;
  const text = new TextDecoder().decode(result.value);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function testStdioServer(config: McpServerStdio): Promise<TestMcpServerResult> {
  const start = Date.now();
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    const env = config.env
      ? { ...process.env, ...Object.fromEntries(config.env.map(e => [e.name, e.value])) }
      : undefined;
    proc = Bun.spawn([config.command, ...(config.args ?? [])], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });

    const stdin = proc.stdin as import('bun').FileSink;
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();

    // 1. Send initialize
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agemon-health-check', version: '1.0.0' },
      },
    }) + '\n');
    stdin.flush();

    const initResponse = await readJsonRpcMessage(reader, 5000);
    if (!initResponse?.result || !(initResponse.result as Record<string, unknown>).protocolVersion) {
      const latencyMs = Date.now() - start;
      if (initResponse) {
        return { status: 'connected', message: 'Process started and responded', latencyMs };
      }
      return { status: 'error', message: 'Process started but timed out waiting for response', latencyMs };
    }

    const initResult = initResponse.result as Record<string, unknown>;
    const serverName = (initResult.serverInfo as Record<string, unknown>)?.name ?? 'unknown';
    const protocolVersion = initResult.protocolVersion as string;

    // 2. Send initialized notification
    stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    stdin.flush();

    // 3. Send tools/list
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n');
    stdin.flush();

    const toolsResponse = await readJsonRpcMessage(reader, 5000);
    const latencyMs = Date.now() - start;

    let tools: McpToolInfo[] | undefined;
    if (toolsResponse?.result) {
      const toolsList = (toolsResponse.result as Record<string, unknown>).tools;
      if (Array.isArray(toolsList)) {
        tools = toolsList.map((t: Record<string, unknown>) => ({
          name: t.name as string,
          ...(t.description ? { description: t.description as string } : {}),
        }));
      }
    }

    return {
      status: 'connected',
      message: `MCP ${protocolVersion} — ${serverName}`,
      latencyMs,
      tools,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Failed to spawn process', latencyMs: Date.now() - start };
  } finally {
    try { proc?.kill(); } catch { /* already dead */ }
  }
}

mcpConfigRoutes.post('/mcp-servers/test', async (c) => {
  const raw = await c.req.json();
  if (!raw?.config || typeof raw.config !== 'object') {
    sendError(400, 'config is required');
  }
  const config = raw.config as Record<string, unknown>;
  if (config.type === 'http') {
    if (typeof config.url !== 'string' || !config.url.trim()) sendError(400, 'config.url is required for http transport');
    return c.json(await testHttpServer(raw.config as McpServerHttp));
  }
  if (typeof config.command !== 'string' || !config.command.trim()) sendError(400, 'config.command is required for stdio transport');
  return c.json(await testStdioServer(raw.config as McpServerStdio));
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
  const raw = await c.req.json();
  validateMcpServerBody(raw);
  const body = normalizeBody(raw);
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

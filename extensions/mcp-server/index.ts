import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { z } from 'zod';
import type { ExtensionContext, ExtensionExports } from '../../backend/src/lib/extensions/types.ts';

const AGENT_TYPES = ['claude-code', 'opencode', 'gemini', 'pi', 'codex'] as const;

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

export function onLoad(ctx: ExtensionContext): ExtensionExports {
  const port = process.env.PORT ?? '3000';
  const host = process.env.HOST ?? '127.0.0.1';
  const baseUrl = `http://${host}:${port}/api`;
  const tasksBaseUrl = `${baseUrl}/extensions/tasks`;
  const key = process.env.AGEMON_KEY ?? '';

  async function request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? `API error ${res.status}`);
    }
    return res.json();
  }

  // Task CRUD lives in the tasks extension; session ops are on the main API.
  function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(`${baseUrl}${path}`, init);
  }
  function tasksApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(`${tasksBaseUrl}${path}`, init);
  }

  // ─── MCP Server + Tools ──────────────────────────────────────────────────

  const mcpServer = new McpServer({ name: 'agemon', version: '1.0.0' });

  mcpServer.tool(
    'create_task',
    'Create a new task in Agemon',
    {
      title: z.string().max(500).describe('Task title'),
      description: z.string().max(10000).optional().describe('Task description'),
      repos: z.array(z.string()).max(20).optional().describe('SSH repo URLs (git@host:org/repo.git)'),
      agent: z.enum(AGENT_TYPES).optional().describe('Agent type (default: claude-code)'),
    },
    async ({ title, description, repos, agent }) => {
      try {
        const task = await tasksApi('/tasks', {
          method: 'POST',
          body: JSON.stringify({ title, description, repos, agent }),
        });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'list_tasks',
    'List all tasks in Agemon',
    {},
    async () => {
      try {
        return textResult(await tasksApi('/tasks'));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'get_task',
    'Get a task by ID',
    { task_id: z.string().describe('Task ID') },
    async ({ task_id }) => {
      try {
        return textResult(await tasksApi(`/tasks/${task_id}`));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'start_session',
    'Start an agent session on a task. Creates worktrees on first session, spawns agent process, runs ACP handshake, and waits until the session is ready.',
    {
      task_id: z.string().describe('Task ID'),
      agent_type: z.enum(AGENT_TYPES).optional().describe('Agent type (defaults to task agent)'),
      wait: z.boolean().optional().describe('Wait for session to be ready (default: true)'),
      timeout_ms: z.number().optional().describe('Max wait time in ms (default: 30000)'),
    },
    async ({ task_id, agent_type, wait, timeout_ms }) => {
      try {
        const session = await tasksApi<{ id: string; state: string }>(`/tasks/${task_id}/sessions`, {
          method: 'POST',
          body: JSON.stringify(agent_type ? { agentType: agent_type } : {}),
        });

        if (wait === false) return textResult(session);

        // Poll until ready, stopped, or crashed
        const timeout = timeout_ms ?? 30_000;
        const pollInterval = 500;
        const deadline = Date.now() + timeout;
        let current = session;

        while (current.state === 'starting' && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, pollInterval));
          current = await api<{ id: string; state: string }>(`/sessions/${session.id}`);
        }

        if (current.state === 'starting') {
          return textResult({ ...current, warning: `Session still starting after ${timeout}ms` });
        }

        return textResult(current);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'send_message',
    'Send a prompt message to a running agent session',
    {
      session_id: z.string().describe('Session ID'),
      content: z.string().describe('Message content to send'),
    },
    async ({ session_id, content }) => {
      try {
        const result = await api(`/sessions/${session_id}/message`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'stop_session',
    'Stop a running agent session',
    { session_id: z.string().describe('Session ID') },
    async ({ session_id }) => {
      try {
        const result = await api(`/sessions/${session_id}/stop`, { method: 'POST' });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  mcpServer.tool(
    'list_sessions',
    'List agent sessions for a task',
    { task_id: z.string().describe('Task ID') },
    async ({ task_id }) => {
      try {
        return textResult(await tasksApi(`/tasks/${task_id}/sessions`));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // ─── HTTP Transport ────────────────────────────────────────────────────────

  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });

  const routes = new Hono();
  routes.all('/mcp', async (c) => {
    if (!mcpServer.isConnected()) {
      await mcpServer.connect(transport);
    }
    return transport.handleRequest(c);
  });

  return { apiRoutes: routes };
}

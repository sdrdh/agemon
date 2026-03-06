import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db, generateTaskId } from '../../db/client.ts';
import { gitManager } from '../git.ts';
import { AGENT_TYPES, SSH_REPO_REGEX } from '@agemon/shared';
import type { AgentType } from '@agemon/shared';

// Dynamic imports to avoid circular dependency: tools → server → mcp/server → tools.
// Cached after first call so the import overhead is one-time only.
let _acp: typeof import('../acp.ts') | null = null;
async function getAcp() {
  if (!_acp) _acp = await import('../acp.ts');
  return _acp;
}

let _broadcast: typeof import('../../server.ts')['broadcast'] | null = null;
async function getBroadcast() {
  if (!_broadcast) _broadcast = (await import('../../server.ts')).broadcast;
  return _broadcast;
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

export function registerTools(server: McpServer): void {
  server.tool(
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
        const repoUrls = repos ?? [];
        for (const url of repoUrls) {
          if (!SSH_REPO_REGEX.test(url)) {
            return errorResult(`Invalid SSH URL: ${url}`);
          }
        }

        const task = db.createTask({
          id: generateTaskId(title),
          title,
          description: description ?? null,
          status: 'todo',
          agent: agent ?? 'claude-code',
          repos: repoUrls,
        });

        const broadcast = await getBroadcast();
        broadcast({ type: 'task_updated', task });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'list_tasks',
    'List all tasks in Agemon',
    {},
    async () => {
      try {
        return textResult(db.listTasks());
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'get_task',
    'Get a task by ID',
    {
      task_id: z.string().describe('Task ID'),
    },
    async ({ task_id }) => {
      try {
        const task = db.getTask(task_id);
        if (!task) return errorResult('Task not found');
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'start_session',
    'Start an agent session on a task. Creates worktrees on first session, spawns agent process, and runs ACP handshake.',
    {
      task_id: z.string().describe('Task ID'),
      agent_type: z.enum(AGENT_TYPES).optional().describe('Agent type (defaults to task agent)'),
    },
    async ({ task_id, agent_type }) => {
      try {
        const task = db.getTask(task_id);
        if (!task) return errorResult('Task not found');

        const agentType: AgentType = agent_type ?? task.agent;

        // Create worktrees if first session
        const existingSessions = db.listSessions(task.id);
        if (existingSessions.length === 0) {
          for (const repo of task.repos) {
            try {
              await gitManager.createWorktree(task.id, repo.url);
            } catch (err) {
              await gitManager.deleteTaskWorktrees(task.id).catch(() => {});
              return errorResult(`Failed to create worktree for ${repo.name}: ${(err as Error).message}`);
            }
          }
        }

        const acp = await getAcp();
        const session = acp.spawnAndHandshake(task.id, agentType);
        return textResult(session);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'send_message',
    'Send a prompt message to a running agent session',
    {
      session_id: z.string().describe('Session ID'),
      content: z.string().describe('Message content to send'),
    },
    async ({ session_id, content }) => {
      try {
        const session = db.getSession(session_id);
        if (!session) return errorResult('Session not found');

        const acp = await getAcp();
        await acp.sendPromptTurn(session_id, content);
        return textResult({ message: 'Message sent', sessionId: session_id });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'stop_session',
    'Stop a running agent session',
    {
      session_id: z.string().describe('Session ID'),
    },
    async ({ session_id }) => {
      try {
        const session = db.getSession(session_id);
        if (!session) return errorResult('Session not found');
        if (session.state !== 'running' && session.state !== 'ready' && session.state !== 'starting') {
          return errorResult(`Session is in state ${session.state}, not stoppable`);
        }

        const acp = await getAcp();
        acp.stopAgent(session_id);
        return textResult({ message: 'Stop signal sent', sessionId: session_id });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    'list_sessions',
    'List agent sessions for a task',
    {
      task_id: z.string().describe('Task ID'),
    },
    async ({ task_id }) => {
      try {
        const task = db.getTask(task_id);
        if (!task) return errorResult('Task not found');
        return textResult(db.listSessions(task_id));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}

import { randomUUID } from 'crypto';
import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions, type RunningSession } from './session-registry.ts';
import { handleNotification } from './notifications.ts';
import { extractToolName, extractToolContext, buildOptionLabel } from './tool-helpers.ts';
import { pendingApprovalResolvers } from './approvals.ts';
import { handleExit } from './lifecycle.ts';
import { JsonRpcTransport } from '../jsonrpc.ts';
import { AGENT_CONFIGS, buildAgentEnv, resolveAgentBinary } from '../agents.ts';
import { runAcpHandshake } from './handshake.ts';
import { refreshTaskContext, getTaskDir, buildFirstPromptContext } from '../context.ts';
import { mkdir } from 'fs/promises';
import type { AgentType, ApprovalOption, PendingApproval, Task } from '@agemon/shared';

/**
 * Ensure the task directory exists and context artifacts are current.
 * Worktrees are created when repos are attached (in routes/tasks.ts),
 * not here — this just ensures the dir + CLAUDE.md/symlinks are ready.
 */
async function prepareTaskDir(task: Task): Promise<void> {
  const taskDir = getTaskDir(task.id);
  await mkdir(taskDir, { recursive: true });
  await refreshTaskContext(task);
}

/**
 * Create the process, transport, and session map entry.
 * Returns the RunningSession. Does NOT run the handshake.
 */
export function spawnProcess(
  sessionId: string,
  taskId: string,
  agentType: AgentType
): RunningSession {
  const binaryPath = resolveAgentBinary(agentType);
  const config = AGENT_CONFIGS[agentType];
  const env = buildAgentEnv(agentType);
  const command = [binaryPath, ...config.command.slice(1)];

  const proc = Bun.spawn(command, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env,
  });

  db.updateSessionState(sessionId, 'starting', { pid: proc.pid });

  const transport = new JsonRpcTransport({
    stdin: proc.stdin,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    timeoutMs: 600_000,
  });

  // Register notification handler
  transport.onNotification((method, params) => {
    handleNotification(method, params, sessionId, taskId);
  });

  // Register incoming request handler (for agent -> client requests)
  transport.onRequest(async (method, params) => {
    if (method === 'requestPermission' || method === 'session/request_permission') {
      const reqParams = params as Record<string, unknown> | undefined;
      const options = (reqParams?.options ?? []) as Array<{ kind: string; optionId: string; label?: string; name?: string }>;

      // Extract tool context from the request
      const toolCall = reqParams?.toolCall as Record<string, unknown> | undefined;
      const toolName = extractToolName(toolCall);
      const toolTitle = (toolCall?.title as string) ?? toolName ?? 'Unknown tool';
      const context = extractToolContext(toolCall);

      // Check "Always Allow" rules first
      const rule = db.findApprovalRule(toolName, taskId, sessionId);
      if (rule) {
        const allowOption = options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always');
        if (allowOption) {
          console.info(`[acp] auto-approved (rule) ${toolName} for session ${sessionId}`);
          return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
        }
      }

      // Map ACP options to our ApprovalOption format.
      // Build descriptive labels from tool context when the agent only sends
      // generic names like "Allow once" / "Always allow".
      const mappedOptions: ApprovalOption[] = options.map(o => {
        // Normalize reject_once → deny (OpenCode uses reject_once)
        const kind = o.kind === 'reject_once' || o.kind === 'reject_always' ? 'deny' : o.kind;
        return {
          kind,
          optionId: o.optionId,
          label: o.label ?? buildOptionLabel(kind, toolName, toolTitle, context),
        };
      });

      // Create pending approval
      const approvalId = randomUUID();
      const approval: PendingApproval = {
        id: approvalId,
        taskId,
        sessionId,
        toolName,
        toolTitle,
        context,
        options: mappedOptions,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.insertPendingApproval(approval);
      broadcast({ type: 'approval_requested', approval });

      // Block until user responds (Promise resolves in resolveApproval())
      return new Promise<Record<string, unknown>>((resolve) => {
        pendingApprovalResolvers.set(approvalId, { resolve, sessionId, taskId });
      });
    }

    console.info(`[acp] incoming request from agent: ${method}`, params);
    return {};
  });

  const rs: RunningSession = {
    proc, transport, sessionId, taskId, agentType, acpSessionId: null, turnInFlight: false,
    promptsSent: 0,
    currentMessageId: null, currentMessageText: '', currentMessageType: 'action',
    configOptions: [], availableCommands: [],
  };

  sessions.set(sessionId, rs);

  // Monitor process exit
  handleExit(proc, transport, sessionId, taskId).catch((err) => {
    console.error(`[acp] handleExit error for session ${sessionId}:`, err);
  });

  return rs;
}

/**
 * Spawn an ACP agent process for a task, run the handshake,
 * and transition to `ready` state. Does NOT send a prompt.
 * Returns the session in `starting` state (handshake is async).
 */
export function spawnAndHandshake(taskId: string, agentType: AgentType) {
  const sessionId = randomUUID();

  db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  const task = db.getTask(taskId);
  if (!task) {
    db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
    throw new Error(`Task ${taskId} not found`);
  }

  const rs = spawnProcess(sessionId, taskId, agentType);

  // Broadcast session_started so all WS clients refresh
  broadcast({ type: 'session_started', taskId, session: db.getSession(sessionId)! });

  // Set up task directory: create worktrees for attached repos, then refresh context
  const agentCwd = getTaskDir(taskId);
  prepareTaskDir(task).then(() =>
    runAcpHandshake(rs.transport, sessionId, taskId, agentCwd)
  ).catch((err) => {
    console.error(`[acp] handshake error for session ${sessionId}:`, err);
  });

  return db.getSession(sessionId)!;
}

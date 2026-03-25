import { randomUUID } from 'crypto';
import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions, type RunningSession } from './session-registry.ts';
import { handleNotification } from './notifications.ts';
import { extractToolName, extractToolContext, buildOptionLabel } from './tool-helpers.ts';
import { pendingApprovalResolvers } from './approvals.ts';
import { handleExit } from './lifecycle.ts';
import { JsonRpcTransport } from '../jsonrpc.ts';
import { buildAgentEnv, resolveAgentBinary } from '../agents.ts';
import { agentRegistry } from '../extensions/agent-registry.ts';
import { runAcpHandshake } from './handshake.ts';
import { initSessionLog } from './event-log.ts';
import { resolveWorkspaceCwd, type SessionMeta } from '../extensions/workspace.ts';
import { defaultTaskWorkspaceProvider } from '../extensions/workspace-default.ts';
import { workspaceRegistry } from '../extensions/workspace-registry.ts';
import { AGEMON_DIR } from '../git.ts';
import type { AgentType, AgentSession, ApprovalOption, PendingApproval } from '@agemon/shared';

/**
 * Create the process, transport, and session map entry.
 * Returns the RunningSession. Does NOT run the handshake.
 */
export function spawnProcess(
  sessionId: string,
  taskId: string | null,
  agentType: AgentType
): RunningSession {
  const provider = agentRegistry.get(agentType);
  if (!provider) throw new Error(`No agent provider registered for type: ${agentType}`);

  const binaryPath = resolveAgentBinary(agentType);  // still uses AGENT_CONFIGS internally
  const config = provider.config;
  const env = buildAgentEnv(agentType);               // still uses AGENT_CONFIGS internally
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
  const meta = { task_id: taskId };
  const metaJson = JSON.stringify(meta);

  db.insertSession({
    id: sessionId,
    meta_json: metaJson,
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

  // Initialize JSONL log
  initSessionLog(sessionId, agentType, meta, AGEMON_DIR).catch(err =>
    console.error(`[acp] failed to init session log for ${sessionId}:`, err)
  );

  // Resolve workspace CWD, then run ACP handshake
  const abortController = new AbortController();
  const sessionMeta: SessionMeta = {
    sessionId,
    agentType,
    meta: { task_id: taskId },
  };

  // Use registry; fall back to defaultTaskWorkspaceProvider for backwards compat
  const workspaceProvider = workspaceRegistry.get('git-worktree') ?? defaultTaskWorkspaceProvider;
  resolveWorkspaceCwd(sessionMeta, workspaceProvider, abortController.signal)
    .then(cwd => runAcpHandshake(rs.transport, sessionId, taskId, cwd))
    .catch((err) => {
      console.error(`[acp] workspace/handshake error for session ${sessionId}:`, err);
      db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
      broadcast({ type: 'session_state_changed', sessionId, taskId, state: 'crashed' });
    });

  return db.getSession(sessionId)!;
}

/**
 * Spawn an already-inserted session by its ID.
 * Looks up the session in the in-memory DB, derives workspace from meta,
 * then runs the same process-spawn + handshake path as spawnAndHandshake.
 *
 * Use ctx.spawnSession() from plugins — call this directly only from core ACP code.
 */
export function spawnSessionById(sessionId: string): AgentSession {
  const session = db.getSession(sessionId);
  if (!session) throw new Error(`[acp] session ${sessionId} not found`);

  const meta: Record<string, unknown> = JSON.parse(session.meta_json ?? '{}');
  const taskId = (meta.task_id as string | undefined) ?? null;
  const agentType = session.agent_type;

  const rs = spawnProcess(sessionId, taskId, agentType);

  broadcast({ type: 'session_started', taskId, session: db.getSession(sessionId)! });

  initSessionLog(sessionId, agentType, meta, AGEMON_DIR).catch(err =>
    console.error(`[acp] failed to init session log for ${sessionId}:`, err)
  );

  const abortController = new AbortController();
  const sessionMeta: SessionMeta = { sessionId, agentType, meta };

  // Route to workspace provider via registry.
  // meta.workspaceProvider is set by tasks plugin at session creation time.
  // Fallback: git-worktree for task sessions, null for standalone sessions.
  const providerId = meta.workspaceProvider as string | undefined;
  const workspaceProvider = providerId
    ? (workspaceRegistry.get(providerId) ?? null)
    : taskId ? workspaceRegistry.get('git-worktree') ?? defaultTaskWorkspaceProvider : null;

  resolveWorkspaceCwd(sessionMeta, workspaceProvider, abortController.signal)
    .then(cwd => runAcpHandshake(rs.transport, sessionId, taskId, cwd))
    .catch((err) => {
      console.error(`[acp] workspace/handshake error for session ${sessionId}:`, err);
      db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
      broadcast({ type: 'session_state_changed', sessionId, taskId, state: 'crashed' });
    });

  return db.getSession(sessionId)!;
}

/**
 * Spawn a session in a local directory without a task.
 * The agent runs in the provided cwd with no git worktree.
 */
export function spawnLocalDirSession(cwd: string, agentType: AgentType) {
  const sessionId = randomUUID();
  const meta = { cwd };
  const metaJson = JSON.stringify(meta);

  db.insertSession({
    id: sessionId,
    meta_json: metaJson,
    agent_type: agentType,
    pid: null,
  });

  const rs = spawnProcess(sessionId, null, agentType);

  broadcast({ type: 'session_started', taskId: null, session: db.getSession(sessionId)! });

  // Initialize JSONL log
  initSessionLog(sessionId, agentType, meta, AGEMON_DIR).catch(err =>
    console.error('[acp] failed to init session log:', err)
  );

  // No workspace provider needed — just run handshake with the provided cwd
  const abortController = new AbortController();
  const sessionMeta: SessionMeta = {
    sessionId,
    agentType,
    meta,
  };

  resolveWorkspaceCwd(sessionMeta, null, abortController.signal)
    .then(resolvedCwd => runAcpHandshake(rs.transport, sessionId, null, resolvedCwd))
    .catch(err => {
      console.error(`[acp] local-dir handshake error for ${sessionId}:`, err);
      db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
      broadcast({ type: 'session_state_changed', sessionId, taskId: null, state: 'crashed' });
    });

  return db.getSession(sessionId)!;
}

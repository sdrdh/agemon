/**
 * ACP (Agent Client Protocol) session manager.
 *
 * Spawns agent processes, performs the JSON-RPC 2.0 handshake
 * (initialize → session/new → session/prompt), maps agent session/update
 * notifications to internal event types, and handles graceful shutdown.
 */

import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentType } from '@agemon/shared';
import { JsonRpcTransport } from './jsonrpc.ts';
import { AGENT_CONFIGS, buildAgentEnv, resolveAgentBinary } from './agents.ts';
import { gitManager } from './git.ts';

// ─── Running Session State ───────────────────────────────────────────────────

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  transport: JsonRpcTransport;
  sessionId: string;
  acpSessionId: string | null;
  turnInFlight: boolean;
  /** Stable ID for the current streaming message (accumulates chunks). */
  currentMessageId: string | null;
  currentMessageText: string;
  currentMessageType: 'thought' | 'action';
}

const sessions = new Map<string, RunningSession>();
const userStopped = new Set<string>(); // Track sessions stopped by user
const KILL_TIMEOUT_MS = 5_000;
const SHUTDOWN_REQUEST_TIMEOUT_MS = 3_000;

// ─── ACP Lifecycle ───────────────────────────────────────────────────────────

/**
 * Run the ACP handshake and prompt turn for a session.
 * Called asynchronously after spawn; errors are logged, not thrown.
 */
async function runAcpLifecycle(
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string,
  task: { title: string; description: string | null },
  cwd: string
): Promise<void> {
  // Mark turn as in-flight for the initial prompt
  const runningSession = sessions.get(sessionId);
  if (runningSession) runningSession.turnInFlight = true;

  try {
    // 1. Initialize — exchange capabilities
    await transport.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'agemon', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    // 2. Create ACP session via session/new
    const sessionResult = await transport.request('session/new', {
      cwd,
      mcpServers: [],
    });

    // Extract the ACP session ID returned by the agent
    const acpSessionId =
      sessionResult &&
      typeof sessionResult === 'object' &&
      'sessionId' in (sessionResult as Record<string, unknown>)
        ? String((sessionResult as Record<string, unknown>).sessionId)
        : null;

    // Store ACP session ID on the running session
    if (runningSession && acpSessionId) {
      runningSession.acpSessionId = acpSessionId;
    }

    // Transition to running
    const extra: { external_session_id?: string } = {};
    if (acpSessionId) extra.external_session_id = acpSessionId;

    db.updateSessionState(sessionId, 'running', extra);
    broadcast({
      type: 'session_started',
      taskId,
      session: db.getSession(sessionId)!,
    });
    db.updateTask(taskId, { status: 'working' });
    const updatedTask = db.getTask(taskId);
    if (updatedTask) broadcast({ type: 'task_updated', task: updatedTask });

    // 3. Send prompt turn with the task
    const prompt = task.description
      ? `${task.title}\n\n${task.description}`
      : task.title;

    if (!acpSessionId) {
      throw new Error('No ACP session ID returned from session/new');
    }

    // session/prompt is a long-running request — results stream as notifications
    // Use a long timeout (10 minutes) since agent work can take a while
    await transport.request('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text: prompt }],
    });

    console.info(`[acp] session ${sessionId} prompt turn completed`);
  } catch (err) {
    if (!transport.isClosed) {
      console.error(`[acp] lifecycle error for session ${sessionId}:`, err);
    }
    // Lifecycle failure doesn't necessarily mean the process died —
    // handleExit will take care of final state transitions
  } finally {
    // Flush any accumulated streaming message
    flushCurrentMessage(sessionId, taskId);
    // Mark initial turn as complete so follow-up turns can be sent
    const rs = sessions.get(sessionId);
    if (rs) rs.turnInFlight = false;
  }
}

// ─── Notification Handler ────────────────────────────────────────────────────

/**
 * Map ACP session/update notifications to internal event types and broadcast.
 */
function handleNotification(
  method: string,
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  // Handle session/update notifications from the agent
  if (method === 'session/update') {
    handleSessionUpdate(params, sessionId, taskId);
    return;
  }

  // Handle __raw__ (non-JSON-RPC output from the agent process)
  if (method === '__raw__') {
    const line =
      params && typeof params === 'object' && 'line' in (params as Record<string, unknown>)
        ? String((params as Record<string, unknown>).line)
        : String(params);

    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content: line,
    });
    broadcast({ type: 'agent_thought', taskId, content: line, eventType: 'thought' });
    return;
  }

  // Unknown notification method — log as thought
  const content = JSON.stringify(params);
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'thought',
    content: `[${method}] ${content}`,
  });
  broadcast({ type: 'agent_thought', taskId, content: `[${method}] ${content}`, eventType: 'thought' });
}

/**
 * Flush any accumulated streaming message to the database.
 * Called when a non-chunk update arrives or when the prompt turn completes.
 */
function flushCurrentMessage(sessionId: string, taskId: string): void {
  const rs = sessions.get(sessionId);
  if (!rs || !rs.currentMessageId || !rs.currentMessageText) return;

  db.insertEvent({
    id: rs.currentMessageId,
    task_id: taskId,
    session_id: sessionId,
    type: rs.currentMessageType,
    content: rs.currentMessageText,
  });

  rs.currentMessageId = null;
  rs.currentMessageText = '';
}

/**
 * Handle a session/update notification from the ACP agent.
 * The update contains a `sessionUpdate` field indicating the type.
 *
 * For streaming chunks (agent_message_chunk, agent_thought_chunk), we
 * accumulate text under a stable messageId and only persist to DB when
 * a non-chunk update arrives or the turn completes.
 */
function handleSessionUpdate(
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  const obj = params as Record<string, unknown> | undefined;
  const update = obj?.update as Record<string, unknown> | undefined;
  if (!update || !('sessionUpdate' in update)) {
    return;
  }

  const updateType = update.sessionUpdate as string;
  const rs = sessions.get(sessionId);

  switch (updateType) {
    case 'agent_message_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      // Start a new streaming message if needed, or continue accumulating
      if (!rs.currentMessageId || rs.currentMessageType !== 'action') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'action';
      }
      rs.currentMessageText += text;

      // Broadcast the delta with a stable messageId so frontend can merge
      broadcast({
        type: 'agent_thought', taskId, content: text,
        eventType: 'action', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'agent_thought_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      if (!rs.currentMessageId || rs.currentMessageType !== 'thought') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'thought';
      }
      rs.currentMessageText += text;

      broadcast({
        type: 'agent_thought', taskId, content: text,
        eventType: 'thought', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'tool_call': {
      // Flush any pending streaming message before tool output
      flushCurrentMessage(sessionId, taskId);

      const title = (update.title as string) ?? 'tool';
      const status = (update.status as string) ?? '';
      const content = `[tool] ${title} (${status})`;

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, content, eventType: 'action' });
      break;
    }

    case 'tool_call_update': {
      const toolCallId = (update.toolCallId as string) ?? '';
      const status = (update.status as string) ?? '';
      if (!status) return;
      const content = `[tool update] ${toolCallId}: ${status}`;

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, content, eventType: 'action' });
      break;
    }

    default: {
      // Other update types (usage_update, available_commands_update, etc.) — ignore silently
      break;
    }
  }
}

// ─── Process Exit Handler ────────────────────────────────────────────────────

async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string
): Promise<void> {
  const exitCode = await proc.exited;
  const state = exitCode === 0 ? 'stopped' : 'crashed';

  transport.close();
  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, taskId, state });

  // If no more active sessions for this task, update task status
  const runningSessions = db
    .listSessions(taskId)
    .filter((s) => s.state === 'running' || s.state === 'starting');

  // Always clean up userStopped, even if other sessions remain
  const wasUserStopped = userStopped.has(sessionId);
  userStopped.delete(sessionId);

  if (runningSessions.length === 0) {

    if (state === 'stopped' && !wasUserStopped) {
      // Agent exited cleanly on its own -> task is done
      db.updateTask(taskId, { status: 'done' });
    } else {
      // User-stopped or crashed -> back to todo
      db.updateTask(taskId, { status: 'todo' });
    }
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });
  }

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
}

// ─── Exported API ────────────────────────────────────────────────────────────

/**
 * Spawn an ACP agent process for a task and begin the JSON-RPC lifecycle.
 * Returns the initial AgentSession record (state: starting).
 */
export function spawnAgent(taskId: string, agentType: AgentType): AgentSession {
  const binaryPath = resolveAgentBinary(agentType);
  const config = AGENT_CONFIGS[agentType];
  const sessionId = randomUUID();

  db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  const env = buildAgentEnv(agentType);

  // Build the full command: replace the first element with the resolved binary path
  const command = [binaryPath, ...config.command.slice(1)];

  const proc = Bun.spawn(command, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env,
  });

  const updated = db.updateSessionState(sessionId, 'starting', { pid: proc.pid });

  // Create JSON-RPC transport over the process's stdio
  const transport = new JsonRpcTransport({
    stdin: proc.stdin,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    timeoutMs: 600_000, // 10 minutes for long-running prompt turns
  });

  // Register notification handler
  transport.onNotification((method, params) => {
    handleNotification(method, params, sessionId, taskId);
  });

  // Register incoming request handler (for agent -> client requests)
  transport.onRequest((method, params) => {
    if (method === 'requestPermission') {
      // Auto-approve all tool calls for headless operation
      const reqParams = params as Record<string, unknown> | undefined;
      const options = (reqParams?.options ?? []) as Array<{ kind: string; optionId: string }>;
      // Prefer allow_once or allow_always
      const allowOption = options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always');
      if (allowOption) {
        console.info(`[acp] auto-approved permission for session ${sessionId}`);
        return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
      }
      // Fallback: select the first option
      if (options.length > 0) {
        return { outcome: { outcome: 'selected', optionId: options[0].optionId } };
      }
      return { outcome: { outcome: 'cancelled' } };
    }

    console.info(`[acp] incoming request from agent: ${method}`, params);
    return {};
  });

  sessions.set(sessionId, {
    proc, transport, sessionId, acpSessionId: null, turnInFlight: false,
    currentMessageId: null, currentMessageText: '', currentMessageType: 'action',
  });

  // Run the ACP lifecycle asynchronously
  const task = db.getTask(taskId);
  if (!task) {
    console.error(`[acp] task ${taskId} not found — killing spawned process`);
    proc.kill('SIGKILL');
    transport.close();
    sessions.delete(sessionId);
    db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
    throw new Error(`Task ${taskId} not found`);
  }

  // Resolve working directory: use first repo's worktree if available
  const agentCwd = task.repos.length > 0
    ? gitManager.getWorktreePath(taskId, task.repos[0].name)
    : process.cwd();

  runAcpLifecycle(transport, sessionId, taskId, {
    title: task.title,
    description: task.description,
  }, agentCwd).catch((err) => {
    console.error(`[acp] lifecycle error for session ${sessionId}:`, err);
  });

  // Monitor process exit
  handleExit(proc, transport, sessionId, taskId).catch((err) => {
    console.error(`[acp] handleExit error for session ${sessionId}:`, err);
  });

  return updated!;
}

/**
 * Send a user's input response to the running agent via JSON-RPC.
 * Returns true if the message was sent, false if no active session was found.
 */
export function sendInputToAgent(sessionId: string, inputId: string, response: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) return false;

  entry.transport.notify('acp/inputResponse', { inputId, response });
  return true;
}

/**
 * Send a follow-up prompt turn to a running agent session.
 * Throws if a turn is already in flight.
 */
export async function sendPromptTurn(sessionId: string, content: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) {
    throw new Error(`No active session found with id ${sessionId}`);
  }

  if (entry.turnInFlight) {
    throw new Error('Agent is still processing');
  }

  // Set flag immediately after check to prevent race conditions
  entry.turnInFlight = true;

  // Look up taskId from the database session record
  const sessionRecord = db.getSession(sessionId);
  if (!sessionRecord) {
    entry.turnInFlight = false;
    throw new Error(`Session ${sessionId} not found in database`);
  }
  const taskId = sessionRecord.task_id;

  // Store user message as an acp_event with type 'prompt'
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'prompt',
    content,
  });

  if (!entry.acpSessionId) {
    entry.turnInFlight = false;
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  try {
    await entry.transport.request('session/prompt', {
      sessionId: entry.acpSessionId,
      prompt: [{ type: 'text', text: content }],
    });
    console.info(`[acp] session ${sessionId} follow-up prompt turn completed`);
  } catch (err) {
    if (!entry.transport.isClosed) {
      console.error(`[acp] follow-up prompt turn error for session ${sessionId}:`, err);
    }
  } finally {
    flushCurrentMessage(sessionId, taskId);
    entry.turnInFlight = false;
  }
}

/**
 * Stop a running agent session.
 * Attempts a graceful JSON-RPC shutdown, then SIGTERM, then SIGKILL.
 */
export function stopAgent(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }

  userStopped.add(sessionId);

  // Attempt graceful JSON-RPC shutdown
  if (!entry.transport.isClosed) {
    entry.transport
      .request('shutdown', {})
      .then(() => {
        entry.transport.notify('exit');
      })
      .catch(() => {
        // Shutdown request failed — fall through to SIGTERM
      });
  }

  // SIGTERM as backup after giving shutdown request a moment
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      entry.proc.kill('SIGTERM');
    }
  }, SHUTDOWN_REQUEST_TIMEOUT_MS);

  // SIGKILL as final fallback
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      console.warn(`[acp] session ${sessionId} did not exit after SIGTERM, sending SIGKILL`);
      entry.proc.kill('SIGKILL');
    }
  }, KILL_TIMEOUT_MS);
}

/**
 * Get a running or starting session for a task.
 */
export function getRunningSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find((s) => s.state === 'running' || s.state === 'starting') ?? null;
}

/**
 * On server startup, mark any sessions that were running/starting as interrupted.
 */
export function recoverInterruptedSessions(): void {
  const startingSessions = db.listSessionsByState('starting');
  const runningSessions = db.listSessionsByState('running');

  for (const session of [...startingSessions, ...runningSessions]) {
    db.updateSessionState(session.id, 'interrupted', { pid: null });
    console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
  }
}

/**
 * Gracefully shut down all running sessions. Called on SIGINT/SIGTERM.
 */
export async function shutdownAllSessions(): Promise<void> {
  const promises: Promise<number>[] = [];

  for (const [sessionId, entry] of sessions) {
    console.info(`[acp] shutting down session ${sessionId}`);

    // Try graceful JSON-RPC shutdown
    if (!entry.transport.isClosed) {
      entry.transport
        .request('shutdown', {})
        .then(() => entry.transport.notify('exit'))
        .catch(() => { /* fall through to SIGTERM */ });
    }

    entry.proc.kill('SIGTERM');
    promises.push(entry.proc.exited);
  }

  if (promises.length > 0) {
    await Promise.race([
      Promise.all(promises),
      new Promise<void>((resolve) => setTimeout(resolve, KILL_TIMEOUT_MS)),
    ]);

    // Force-kill any remaining sessions
    for (const [, entry] of sessions) {
      entry.proc.kill('SIGKILL');
    }
  }
}

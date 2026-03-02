/**
 * ACP (Agent Client Protocol) session manager.
 *
 * Spawns agent processes, performs the JSON-RPC 2.0 handshake
 * (initialize → setSessionInfo → promptTurn), maps agent notifications
 * to internal event types, and handles graceful shutdown.
 */

import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentType } from '@agemon/shared';
import { JsonRpcTransport } from './jsonrpc.ts';
import { AGENT_CONFIGS, buildAgentEnv, resolveAgentBinary } from './agents.ts';

// ─── Running Session State ───────────────────────────────────────────────────

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  transport: JsonRpcTransport;
  sessionId: string;
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
  task: { title: string; description: string | null }
): Promise<void> {
  try {
    // 1. Initialize — exchange capabilities
    const initResult = await transport.request('initialize', {
      clientInfo: { name: 'agemon', version: '1.0.0' },
      capabilities: {},
    });

    // Extract external session ID from init result if available
    const extra: { external_session_id?: string } = {};
    if (
      initResult &&
      typeof initResult === 'object' &&
      'sessionId' in (initResult as Record<string, unknown>)
    ) {
      extra.external_session_id = String(
        (initResult as Record<string, unknown>).sessionId
      );
    }

    // Transition to running
    db.updateSessionState(sessionId, 'running', extra);
    broadcast({
      type: 'session_started',
      taskId,
      session: db.getSession(sessionId)!,
    });
    db.updateTask(taskId, { status: 'working' });
    const updatedTask = db.getTask(taskId);
    if (updatedTask) broadcast({ type: 'task_updated', task: updatedTask });

    // 2. Set session info
    transport.notify('acp/setSessionInfo', {
      sessionId,
      taskId,
    });

    // 3. Send prompt turn with the task
    const prompt = task.description
      ? `${task.title}\n\n${task.description}`
      : task.title;

    // promptTurn is a long-running request — results stream as notifications
    // Use a long timeout (10 minutes) since agent work can take a while
    await transport.request('acp/promptTurn', {
      messages: [{ role: 'user', content: prompt }],
    });

    console.info(`[acp] session ${sessionId} prompt turn completed`);
  } catch (err) {
    if (!transport.isClosed) {
      console.error(`[acp] lifecycle error for session ${sessionId}:`, err);
    }
    // Lifecycle failure doesn't necessarily mean the process died —
    // handleExit will take care of final state transitions
  }
}

// ─── Notification Handler ────────────────────────────────────────────────────

/**
 * Map ACP notification methods to internal event types and broadcast.
 */
function handleNotification(
  method: string,
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  const content =
    params && typeof params === 'object' && 'content' in (params as Record<string, unknown>)
      ? String((params as Record<string, unknown>).content)
      : JSON.stringify(params);

  switch (method) {
    case 'acp/thought':
    case 'acp/progress': {
      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'thought',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, content });
      break;
    }

    case 'acp/action': {
      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, content });
      break;
    }

    case 'acp/awaitInput':
    case 'acp/requestInput': {
      const question =
        params && typeof params === 'object' && 'question' in (params as Record<string, unknown>)
          ? String((params as Record<string, unknown>).question)
          : content;

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'await_input',
        content,
      });

      const inputId = randomUUID();
      db.insertAwaitingInput({
        id: inputId,
        task_id: taskId,
        session_id: sessionId,
        question,
      });
      db.updateTask(taskId, { status: 'awaiting_input' });
      const task = db.getTask(taskId);
      if (task) broadcast({ type: 'task_updated', task });
      broadcast({ type: 'awaiting_input', taskId, question, inputId });
      break;
    }

    case '__raw__': {
      // Raw non-JSON-RPC output from the agent process
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
      broadcast({ type: 'agent_thought', taskId, content: line });
      break;
    }

    default: {
      // Unknown notification method — log as thought
      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'thought',
        content: `[${method}] ${content}`,
      });
      broadcast({ type: 'agent_thought', taskId, content: `[${method}] ${content}` });
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

  broadcast({ type: 'session_state_changed', sessionId, state });

  // If no more active sessions for this task, update task status
  const runningSessions = db
    .listSessions(taskId)
    .filter((s) => s.state === 'running' || s.state === 'starting');

  if (runningSessions.length === 0) {
    const wasUserStopped = userStopped.has(sessionId);
    userStopped.delete(sessionId);

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
    console.info(`[acp] incoming request from agent: ${method}`, params);
    // Return empty result for now; extend as agents require specific responses
    return {};
  });

  sessions.set(sessionId, { proc, transport, sessionId });

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

  runAcpLifecycle(transport, sessionId, taskId, {
    title: task.title,
    description: task.description,
  }).catch((err) => {
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

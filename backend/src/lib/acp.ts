import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentType } from '@agemon/shared';

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  sessionId: string;
}

const sessions = new Map<string, RunningSession>();
const KILL_TIMEOUT_MS = 5_000;

function checkBinary(): string {
  const path = Bun.which('claude-agent-acp');
  if (!path) {
    throw new Error('claude-agent-acp not found on PATH. Install it from https://github.com/zed-industries/claude-agent-acp');
  }
  return path;
}

export function spawnAgent(taskId: string, agentType: AgentType): AgentSession {
  const binaryPath = checkBinary();
  const sessionId = randomUUID();

  const session = db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  const proc = Bun.spawn([binaryPath, '--agent', agentType], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  db.updateSessionState(sessionId, 'starting', { pid: proc.pid });
  sessions.set(sessionId, { proc, sessionId });

  readStdout(proc, sessionId, taskId);
  handleExit(proc, sessionId, taskId);

  return session;
}

async function readStdout(
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
  taskId: string
) {
  if (!proc.stdout || typeof proc.stdout === 'number') return;

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let hasExternalId = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          // If we haven't transitioned to running yet, do it now
          if (!hasExternalId && event.session_id) {
            db.updateSessionState(sessionId, 'running', {
              external_session_id: event.session_id,
            });
            hasExternalId = true;
            broadcast({
              type: 'session_started',
              taskId,
              session: db.getSession(sessionId)!,
            });
            db.updateTask(taskId, { status: 'working' });
            const task = db.getTask(taskId);
            if (task) broadcast({ type: 'task_updated', task });
            continue;
          }

          if (!hasExternalId) {
            db.updateSessionState(sessionId, 'running');
            hasExternalId = true;
            broadcast({
              type: 'session_started',
              taskId,
              session: db.getSession(sessionId)!,
            });
            db.updateTask(taskId, { status: 'working' });
            const task = db.getTask(taskId);
            if (task) broadcast({ type: 'task_updated', task });
          }

          // Process known event types
          const eventType = event.type;
          if (eventType === 'thought' || eventType === 'action' || eventType === 'await_input' || eventType === 'result') {
            db.insertEvent({
              id: randomUUID(),
              task_id: taskId,
              session_id: sessionId,
              type: eventType,
              content: line,
            });

            if (eventType === 'await_input') {
              const inputId = randomUUID();
              db.insertAwaitingInput({
                id: inputId,
                task_id: taskId,
                session_id: sessionId,
                question: event.content ?? event.message ?? line,
              });
              db.updateTask(taskId, { status: 'awaiting_input' });
              const task = db.getTask(taskId);
              if (task) broadcast({ type: 'task_updated', task });
              broadcast({
                type: 'awaiting_input',
                taskId,
                question: event.content ?? event.message ?? line,
                inputId,
              });
            } else {
              broadcast({
                type: 'agent_thought',
                taskId,
                content: event.content ?? line,
              });
            }
          }
        } catch {
          // Non-JSON line — treat as raw thought output once session is running
          if (hasExternalId) {
            db.insertEvent({
              id: randomUUID(),
              task_id: taskId,
              session_id: sessionId,
              type: 'thought',
              content: line,
            });
            broadcast({ type: 'agent_thought', taskId, content: line });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[acp] stdout read error for session ${sessionId}:`, err);
  }
}

async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
  taskId: string
) {
  const exitCode = await proc.exited;
  const state = exitCode === 0 ? 'stopped' : 'crashed';

  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, state });

  // If no more active sessions for this task, update task status
  const runningSessions = db.listSessions(taskId).filter(s => s.state === 'running' || s.state === 'starting');
  if (runningSessions.length === 0) {
    if (state === 'stopped') {
      db.updateTask(taskId, { status: 'done' });
    } else {
      db.updateTask(taskId, { status: 'todo' });
    }
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });
  }

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
}

export function stopAgent(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }

  entry.proc.kill('SIGTERM');

  setTimeout(() => {
    if (sessions.has(sessionId)) {
      console.warn(`[acp] session ${sessionId} did not exit after SIGTERM, sending SIGKILL`);
      entry.proc.kill('SIGKILL');
    }
  }, KILL_TIMEOUT_MS);
}

export function getRunningSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find(s => s.state === 'running' || s.state === 'starting') ?? null;
}

export function recoverInterruptedSessions(): void {
  const startingSessions = db.listSessionsByState('starting');
  const runningSessions = db.listSessionsByState('running');

  for (const session of [...startingSessions, ...runningSessions]) {
    db.updateSessionState(session.id, 'interrupted', { pid: null });
    console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
  }
}

export async function shutdownAllSessions(): Promise<void> {
  const promises: Promise<number>[] = [];
  for (const [sessionId, entry] of sessions) {
    console.info(`[acp] shutting down session ${sessionId}`);
    entry.proc.kill('SIGTERM');
    promises.push(entry.proc.exited);
  }
  if (promises.length > 0) {
    await Promise.race([
      Promise.all(promises),
      new Promise<void>(resolve => setTimeout(resolve, KILL_TIMEOUT_MS)),
    ]);
    // Force-kill any remaining sessions
    for (const [, entry] of sessions) {
      entry.proc.kill('SIGKILL');
    }
  }
}

import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions, userStopped, KILL_TIMEOUT_MS, SHUTDOWN_REQUEST_TIMEOUT_MS } from './session-registry.ts';
import { deriveTaskStatus } from './task-status.ts';
import { resolveApproval } from './approvals.ts';
import type { JsonRpcTransport } from '../jsonrpc.ts';
import type { AgentSessionState, AgentSession } from '@agemon/shared';

/**
 * Process exit handler. Cleans up session state and broadcasts to clients.
 */
export async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string
): Promise<void> {
  const exitCode = await proc.exited;
  const state: AgentSessionState = exitCode === 0 ? 'stopped' : 'crashed';

  transport.close();

  // Deny all pending approvals for this session
  const pendingApprovals = db.listPendingApprovalsBySession(sessionId);
  for (const approval of pendingApprovals) {
    resolveApproval(approval.id, 'deny');
  }

  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);
  userStopped.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, taskId, state });

  // Derive task status from remaining sessions
  deriveTaskStatus(taskId);

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
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
 * Get a running, ready, or starting session for a task.
 */
export function getActiveSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find((s) => s.state === 'running' || s.state === 'ready' || s.state === 'starting') ?? null;
}

/**
 * On server startup, mark any sessions that were running/starting/ready as interrupted.
 * If the `auto_resume_sessions` setting is enabled, also attempt to resume them.
 */
export async function recoverInterruptedSessions(): Promise<void> {
  for (const state of ['starting', 'ready', 'running'] as const) {
    const stateSessions = db.listSessionsByState(state);
    for (const session of stateSessions) {
      db.updateSessionState(session.id, 'interrupted', { pid: null });
      console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
    }
  }

  // Auto-resume is opt-in — do nothing if the setting is not explicitly enabled
  if (db.getSetting('auto_resume_sessions') !== 'true') {
    return;
  }

  const interruptedSessions = db.listSessionsByState('interrupted').filter(
    (s) => s.external_session_id !== null
  );

  if (interruptedSessions.length === 0) {
    return;
  }

  console.info(`[acp] auto-resume: ${interruptedSessions.length} interrupted session(s) eligible`);

  // Dynamic import to avoid circular dependency (resume.ts imports from lifecycle.ts indirectly)
  const { resumeSession } = await import('./resume.ts');

  // Process in batches of 3 to avoid overwhelming the system
  const BATCH_SIZE = 3;
  for (let i = 0; i < interruptedSessions.length; i += BATCH_SIZE) {
    const batch = interruptedSessions.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (session) => {
        try {
          await resumeSession(session.id);
          console.info(`[acp] auto-resume: session ${session.id} resumed successfully`);
        } catch (err) {
          db.updateSessionState(session.id, 'crashed');
          console.warn(`[acp] auto-resume: session ${session.id} failed to resume, marked as crashed:`, err);
        }
      })
    );
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

/**
 * Cancel the current turn for a session without killing the process.
 * 1. Auto-deny any pending approvals (unblocks the JSON-RPC request handler)
 * 2. Send ACP session/cancel notification (the agent will respond to the
 *    in-flight session/prompt with stopReason: "cancelled")
 * 3. The session stays alive and ready for the next prompt.
 */
export function cancelTurn(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }
  if (!entry.turnInFlight) {
    throw new Error('No turn in flight to cancel');
  }
  if (!entry.acpSessionId) {
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  // 1. Auto-deny all pending approvals for this session
  //    (resolves the blocked Promises so the transport isn't stuck)
  const pendingApprovals = db.listPendingApprovalsBySession(sessionId);
  for (const approval of pendingApprovals) {
    resolveApproval(approval.id, 'deny');
  }

  // 2. Send ACP session/cancel notification (fire-and-forget, no response expected).
  //    Note: turnInFlight is NOT reset here — the in-flight sendPromptTurn() call
  //    will receive stopReason: "cancelled" and its finally block handles cleanup
  //    (flushCurrentMessage, turnInFlight = false, deriveTaskStatus).
  entry.transport.notify('session/cancel', { sessionId: entry.acpSessionId });
  console.info(`[acp] session ${sessionId} turn cancel sent`);
}

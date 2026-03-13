import { db } from '../../db/client.ts';
import { sessions } from './session-registry.ts';
import { broadcast } from '../../server.ts';
import type { TaskStatus } from '@agemon/shared';

/**
 * Derive and update task status from the current state of all its sessions.
 * Called whenever a session state changes.
 *
 * This is a pure derivation function (no side effects except DB write + broadcast).
 */
export function deriveTaskStatus(taskId: string): void {
  const task = db.getTask(taskId);
  if (!task || task.status === 'done') return; // don't override explicit done

  const taskSessions = db.listSessions(taskId);

  const runningSessions = taskSessions.filter(s => s.state === 'running');
  const hasRunning = runningSessions.length > 0;
  const hasReady = taskSessions.some(s => s.state === 'ready' || s.state === 'starting');
  const hasPendingInput = db.listPendingInputs(taskId).length > 0;

  // Check if any running session is actively processing a turn
  const anyTurnInFlight = runningSessions.some(s => {
    const rs = sessions.get(s.id);
    return rs?.turnInFlight === true;
  });

  let newStatus: TaskStatus = task.status;
  if (hasRunning && anyTurnInFlight) {
    newStatus = 'working';
  } else if (hasRunning && !anyTurnInFlight) {
    // All running sessions idle — agent waiting for user's next message
    newStatus = 'awaiting_input';
  } else if (hasPendingInput) {
    newStatus = 'awaiting_input';
  } else if (hasReady) {
    // Sessions ready but none running — waiting for user's first prompt
    newStatus = 'awaiting_input';
  } else {
    // All sessions stopped/crashed — back to todo (user must mark done explicitly)
    newStatus = 'todo';
  }

  if (newStatus !== task.status) {
    db.updateTask(taskId, { status: newStatus });
    const updated = db.getTask(taskId);
    if (updated) broadcast({ type: 'task_updated', task: updated });
  }
}

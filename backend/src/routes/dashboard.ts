import { Hono } from 'hono';
import { db } from '../db/client.ts';
import type { DashboardActiveResponse, DashboardBlockedSession, DashboardIdleSession } from '@agemon/shared';

export const dashboardRoutes = new Hono();

/**
 * GET /dashboard/active — returns blocked + idle active sessions for the dashboard.
 * Blocked = has pending input or pending approval.
 * Idle = running/ready, no pending items, active within 6h.
 */
dashboardRoutes.get('/dashboard/active', (c) => {
  const activeSessions = db.listActiveSessions();
  const allPendingInputs = db.listAllPendingInputs();
  const allPendingApprovals = db.listAllPendingApprovals();

  // Batch-fetch all referenced tasks upfront (avoids N+1)
  const taskIds = new Set(activeSessions.map(s => s.task_id).filter((id): id is string => id !== null));
  const taskMap = new Map<string, { id: string; title: string; description: string | null }>();
  for (const id of taskIds) {
    const task = db.getTask(id);
    if (task) taskMap.set(id, { id: task.id, title: task.title, description: task.description });
  }

  // Index pending items by session ID
  const inputsBySession = new Map<string, typeof allPendingInputs>();
  for (const input of allPendingInputs) {
    const list = inputsBySession.get(input.session_id) ?? [];
    list.push(input);
    inputsBySession.set(input.session_id, list);
  }

  const approvalsBySession = new Map<string, typeof allPendingApprovals>();
  for (const approval of allPendingApprovals) {
    const list = approvalsBySession.get(approval.sessionId) ?? [];
    list.push(approval);
    approvalsBySession.set(approval.sessionId, list);
  }

  const blocked: DashboardBlockedSession[] = [];
  const idle: DashboardIdleSession[] = [];

  for (const session of activeSessions) {
    const taskSummary = session.task_id ? taskMap.get(session.task_id) : null;
    // For task-free sessions, create a placeholder task summary
    const effectiveTaskSummary = taskSummary ?? (session.task_id === null
      ? { id: '', title: session.name ?? 'Local session', description: null }
      : null);
    if (!effectiveTaskSummary) continue;

    const sessionInputs = inputsBySession.get(session.id) ?? [];
    const sessionApprovals = approvalsBySession.get(session.id) ?? [];

    // Blocked = has pending items (any active state)
    // Idle = ready/starting with no pending items (running sessions appear in "Active" on frontend)
    const isBlocked = sessionInputs.length > 0 || sessionApprovals.length > 0;
    const isIdle = !isBlocked && session.state !== 'running';
    if (!isBlocked && !isIdle) continue;

    const lastAgentMessage = db.getLastAgentMessage(session.id);

    if (isBlocked) {
      blocked.push({
        session,
        task: effectiveTaskSummary,
        lastAgentMessage,
        pendingInputs: sessionInputs,
        pendingApprovals: sessionApprovals,
      });
    } else {
      idle.push({
        session,
        task: effectiveTaskSummary,
        lastAgentMessage,
      });
    }
  }

  const response: DashboardActiveResponse = { blocked, idle };
  return c.json(response);
});

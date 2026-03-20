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
  const taskIds = new Set(activeSessions.map(s => s.task_id));
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

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const blocked: DashboardBlockedSession[] = [];
  const idle: DashboardIdleSession[] = [];

  for (const session of activeSessions) {
    const taskSummary = taskMap.get(session.task_id);
    if (!taskSummary) continue;

    const sessionInputs = inputsBySession.get(session.id) ?? [];
    const sessionApprovals = approvalsBySession.get(session.id) ?? [];

    // Only fetch lastAgentMessage for sessions that will appear in the response
    const isBlocked = sessionInputs.length > 0 || sessionApprovals.length > 0;
    const isIdle = !isBlocked && session.started_at >= sixHoursAgo;
    if (!isBlocked && !isIdle) continue;

    const lastAgentMessage = db.getLastAgentMessage(session.id);

    if (isBlocked) {
      blocked.push({
        session,
        task: taskSummary,
        lastAgentMessage,
        pendingInputs: sessionInputs,
        pendingApprovals: sessionApprovals,
      });
    } else {
      idle.push({
        session,
        task: taskSummary,
        lastAgentMessage,
      });
    }
  }

  const response: DashboardActiveResponse = { blocked, idle };
  return c.json(response);
});

import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { resolveApproval } from '../lib/acp/index.ts';
import { sendError } from './shared.ts';
import type { ApprovalDecision } from '@agemon/shared';

export const approvalsRoutes = new Hono();

/**
 * GET /tasks/:id/approvals — list pending or all approvals for a task.
 */
approvalsRoutes.get('/tasks/:id/approvals', (c) => {
  const all = c.req.query('all') === '1';
  const approvals = all
    ? db.listAllApprovals(c.req.param('id'))
    : db.listPendingApprovals(c.req.param('id'));
  return c.json(approvals);
});

/**
 * GET /sessions/:id/approvals — list pending approvals for a session.
 */
approvalsRoutes.get('/sessions/:id/approvals', (c) => {
  const sessionId = c.req.param('id');
  const approvals = db.listPendingApprovalsBySession(sessionId);
  return c.json(approvals);
});

/**
 * POST /approvals/:id/resolve — resolve a pending tool approval.
 * Body: { decision: 'allow_once' | 'allow_always' | 'deny' }
 */
approvalsRoutes.post('/approvals/:id/resolve', async (c) => {
  const approvalId = c.req.param('id');
  let body: { decision?: string } = {};
  try { body = await c.req.json(); } catch { return sendError(400, 'Request body must be valid JSON'); }
  const decision = body.decision;
  if (decision !== 'allow_once' && decision !== 'allow_always' && decision !== 'deny') {
    return sendError(400, 'decision must be allow_once, allow_always, or deny');
  }
  const resolved = resolveApproval(approvalId, decision as ApprovalDecision);
  if (!resolved) return sendError(404, `Unknown or already resolved approvalId: ${approvalId}`);
  return c.json({ ok: true });
});

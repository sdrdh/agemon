import { Hono } from 'hono';
import { db } from '../db/client.ts';

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

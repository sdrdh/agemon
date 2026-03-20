import { getDb } from './client.ts';
import { mapApproval, APPROVAL_COLUMNS, type RawApproval } from './helpers.ts';
import type { PendingApproval, ApprovalDecision, ApprovalRule } from '@agemon/shared';

export function insertPendingApproval(approval: PendingApproval): void {
  const database = getDb();
  database.run(
    'INSERT INTO pending_approvals (id, task_id, session_id, tool_name, tool_title, context, options, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [approval.id, approval.taskId, approval.sessionId, approval.toolName, approval.toolTitle, JSON.stringify(approval.context), JSON.stringify(approval.options), approval.status, approval.createdAt]
  );
}

export function resolvePendingApproval(id: string, decision: ApprovalDecision): void {
  const database = getDb();
  database.run(
    "UPDATE pending_approvals SET status = 'resolved', decision = ? WHERE id = ?",
    [decision, id]
  );
}

export function getPendingApproval(id: string): PendingApproval | null {
  const row = getDb().query<RawApproval, [string]>(
    `SELECT ${APPROVAL_COLUMNS} FROM pending_approvals WHERE id = ?`
  ).get(id);
  return row ? mapApproval(row) : null;
}

export function listPendingApprovals(taskId: string): PendingApproval[] {
  return getDb().query<RawApproval, [string]>(
    `SELECT ${APPROVAL_COLUMNS} FROM pending_approvals WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC`
  ).all(taskId).map(mapApproval);
}

export function listPendingApprovalsBySession(sessionId: string): PendingApproval[] {
  return getDb().query<RawApproval, [string]>(
    `SELECT ${APPROVAL_COLUMNS} FROM pending_approvals WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC`
  ).all(sessionId).map(mapApproval);
}

export function listAllPendingApprovals(): PendingApproval[] {
  return getDb().query<RawApproval, []>(
    `SELECT ${APPROVAL_COLUMNS} FROM pending_approvals WHERE status = 'pending' ORDER BY created_at DESC`
  ).all().map(mapApproval);
}

export function listAllApprovals(taskId: string): PendingApproval[] {
  return getDb().query<RawApproval, [string]>(
    `SELECT ${APPROVAL_COLUMNS} FROM pending_approvals WHERE task_id = ? ORDER BY created_at ASC`
  ).all(taskId).map(mapApproval);
}

export function insertApprovalRule(rule: ApprovalRule): void {
  const database = getDb();
  database.run(
    'INSERT INTO approval_rules (id, task_id, session_id, tool_name, created_at) VALUES (?, ?, ?, ?, ?)',
    [rule.id, rule.taskId, rule.sessionId, rule.toolName, rule.createdAt]
  );
}

export function findApprovalRule(toolName: string, taskId: string, sessionId: string | null): ApprovalRule | null {
  const database = getDb();
  interface RawRule {
    id: string;
    task_id: string | null;
    session_id: string | null;
    tool_name: string;
    created_at: string;
  }
  // Match: exact task + any session, or global (null task)
  const row = database.query<RawRule, [string, string]>(
    "SELECT * FROM approval_rules WHERE tool_name = ? AND (task_id = ? OR task_id IS NULL) ORDER BY task_id DESC LIMIT 1"
  ).get(toolName, taskId);
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    createdAt: row.created_at,
  };
}

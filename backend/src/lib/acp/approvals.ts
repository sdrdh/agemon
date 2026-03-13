import { randomUUID } from 'crypto';
import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import type { ApprovalDecision, ApprovalOption } from '@agemon/shared';

// ─── Pending Approval Resolver Registry ─────────────────────────────────────

export const pendingApprovalResolvers = new Map<string, {
  resolve: (response: Record<string, unknown>) => void;
  sessionId: string;
  taskId: string;
}>();

/**
 * Resolve a pending tool approval. Called from the WebSocket handler
 * when the user clicks Allow Once / Always Allow / Deny.
 */
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision
): boolean {
  const pending = pendingApprovalResolvers.get(approvalId);
  if (!pending) return false;

  const approval = db.getPendingApproval(approvalId);
  if (!approval || approval.status !== 'pending') return false;

  // Find the matching ACP option
  const options = approval.options as ApprovalOption[];
  let selectedOption: ApprovalOption | undefined;

  if (decision === 'allow_once') {
    selectedOption = options.find(o => o.kind === 'allow_once');
  } else if (decision === 'allow_always') {
    selectedOption = options.find(o => o.kind === 'allow_always' || o.kind === 'allow_once');
  } else if (decision === 'deny') {
    selectedOption = options.find(o => o.kind === 'deny');
  }

  // Update DB
  db.resolvePendingApproval(approvalId, decision);

  // Create "Always Allow" rule if requested
  if (decision === 'allow_always' && approval.toolName) {
    db.insertApprovalRule({
      id: randomUUID(),
      taskId: approval.taskId,
      sessionId: null, // Apply to all sessions in this task
      toolName: approval.toolName,
      createdAt: new Date().toISOString(),
    });
  }

  // Resolve the blocked Promise → unblocks the JSON-RPC response to agent
  if (selectedOption) {
    pending.resolve({ outcome: { outcome: 'selected', optionId: selectedOption.optionId } });
  } else {
    pending.resolve({ outcome: { outcome: 'cancelled' } });
  }

  pendingApprovalResolvers.delete(approvalId);
  broadcast({ type: 'approval_resolved', approvalId, decision });
  return true;
}

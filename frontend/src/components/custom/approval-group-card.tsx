import { useState, useMemo } from 'react';
import { ChevronRight, Shield, ShieldCheck, ShieldX } from 'lucide-react';
import { ApprovalCard } from '@/components/custom/approval-card';
import type { PendingApproval, ApprovalDecision } from '@agemon/shared';

interface ApprovalGroupCardProps {
  approvalIds: string[];
  approvalLookup: Map<string, PendingApproval>;
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  connected: boolean;
}

export function ApprovalGroupCard({ approvalIds, approvalLookup, onApprovalDecision, connected }: ApprovalGroupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const approvals = useMemo(
    () => approvalIds.map((id) => approvalLookup.get(id)).filter(Boolean) as PendingApproval[],
    [approvalIds, approvalLookup],
  );

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const allowedCount = approvals.filter((a) => a.decision === 'allow_once' || a.decision === 'allow_always').length;
  const deniedCount = approvals.filter((a) => a.decision === 'deny').length;

  const hasPending = pendingCount > 0;

  // Build summary text
  const parts: string[] = [];
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (allowedCount > 0) parts.push(`${allowedCount} allowed`);
  if (deniedCount > 0) parts.push(`${deniedCount} denied`);
  const summary = `${approvals.length} approval${approvals.length !== 1 ? 's' : ''}` + (parts.length > 0 ? ` · ${parts.join(', ')}` : '');

  const borderColor = hasPending ? 'border-warning/50' : 'border-muted';

  // Auto-expand if any are pending
  const isExpanded = expanded || hasPending;

  return (
    <div
      className={`border-l-2 ${borderColor} pl-3 my-1 select-none`}
    >
      {/* Summary row */}
      <div
        className="flex items-center gap-1.5 text-sm text-muted-foreground min-h-[44px] cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        {hasPending
          ? <Shield className="h-3.5 w-3.5 text-warning shrink-0" />
          : allowedCount > 0
            ? <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
            : <ShieldX className="h-3.5 w-3.5 text-destructive shrink-0" />
        }
        <span>{summary}</span>
      </div>

      {/* Expanded: individual approval cards */}
      <div
        className="grid"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 pb-2">
            {approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onDecision={onApprovalDecision}
                connected={connected}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

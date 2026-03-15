import { useState } from 'react';
import type { PendingApproval, ApprovalDecision } from '@agemon/shared';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ApprovalCard } from '@/components/custom/approval-card';
import { agentDisplayName } from '@/components/custom/agent-icons';
import { formatRelativeTime } from '@/lib/time-utils';

interface DashboardApprovalCardProps {
  approval: PendingApproval;
  taskName: string;
  taskDescription?: string;
  lastMessage?: { text: string; role: 'agent' | 'user' };
  agentType: string;
  connected: boolean;
  onDecision: (approvalId: string, decision: ApprovalDecision) => void;
  onNavigate: () => void;
}

export function DashboardApprovalCard({
  approval,
  taskName,
  taskDescription,
  lastMessage,
  agentType,
  connected,
  onDecision,
  onNavigate,
}: DashboardApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContext = !!taskDescription || !!lastMessage;

  return (
    <div
      className="rounded-lg bg-card border-l-4 border-amber-400 overflow-hidden cursor-pointer"
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate(); }}
    >
      <div className="px-3 pt-3 pb-1">
        {/* Top line: badge + timestamp */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <Badge
            variant="outline"
            className="text-xs border-amber-400/50 bg-amber-500/10 text-amber-500 font-semibold"
          >
            ⚡ APPROVAL
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatRelativeTime(approval.createdAt)}
          </span>
        </div>
        {/* Second line: task + agent */}
        <p className="text-xs text-muted-foreground truncate">
          {taskName} · {agentDisplayName(agentType)}
        </p>

        {/* Task description (always visible when available) */}
        {taskDescription && (
          <p className="text-xs text-foreground/60 mt-1.5 line-clamp-2">
            {taskDescription}
          </p>
        )}

        {/* Expandable context toggle */}
        {hasContext && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1.5 min-h-[28px] transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Less context' : 'More context'}
          </button>
        )}

        {/* Expanded: last message context */}
        {expanded && lastMessage && (
          <div className="mt-1.5 rounded-md bg-muted p-2">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">
              {lastMessage.role === 'user' ? 'Your last message:' : 'Last agent thought:'}
            </p>
            <p className="text-xs text-foreground/70 line-clamp-4">{lastMessage.text}</p>
          </div>
        )}
      </div>

      {/* Stop click propagation so approval card buttons work */}
      <div
        className="px-3 pb-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ApprovalCard approval={approval} onDecision={onDecision} connected={connected} />
      </div>
    </div>
  );
}

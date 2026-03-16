import { useState } from 'react';
import { Shield, Check, X, ShieldCheck, ShieldX } from 'lucide-react';
import type { PendingApproval, ApprovalDecision } from '@agemon/shared';

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (approvalId: string, decision: ApprovalDecision) => void;
}

export function ApprovalCard({ approval, onDecision }: ApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const isPending = approval.status === 'pending';
  const isAllowed = approval.decision === 'allow_once' || approval.decision === 'allow_always';

  const handleClick = (decision: ApprovalDecision) => {
    if (submitting || !isPending) return;
    setSubmitting(true);
    onDecision(approval.id, decision);
  };

  const { context, toolName, toolTitle, options } = approval;
  const filePath = context.filePath || context.path || '';
  const command = context.command || '';
  const hasOldNew = context.oldString || context.newString;

  // Compact context line: "fetch · exe.dev platform 2026" or "Edit · src/App.tsx"
  const contextLine = filePath || (toolTitle !== toolName ? toolTitle : '');

  // Label for "allow always" — use the ACP-provided label so it shows the exact scope
  // e.g. "Allow always for git *" or "Trust all Bash commands"
  const allowAlwaysOption = options.find(o => o.kind === 'allow_always');
  const allowAlwaysLabel = allowAlwaysOption?.label ?? `Allow always · ${toolName}`;

  const borderColor = isPending
    ? 'border-amber-400/50'
    : isAllowed
      ? 'border-emerald-500/30'
      : 'border-red-500/30';

  const bgColor = isPending
    ? 'bg-amber-50/40 dark:bg-amber-950/15'
    : isAllowed
      ? 'bg-emerald-50/20 dark:bg-emerald-950/10'
      : 'bg-red-50/20 dark:bg-red-950/10';

  // Resolved state — single compact line
  if (!isPending) {
    return (
      <div className={`my-1 flex items-center gap-2 rounded-md border ${borderColor} ${bgColor} px-2.5 py-1.5 text-xs`}>
        {isAllowed
          ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          : <ShieldX className="h-3.5 w-3.5 text-red-500 shrink-0" />
        }
        <span className="font-mono font-medium">{toolName}</span>
        {contextLine && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground truncate">{contextLine}</span>
          </>
        )}
        <span className={`ml-auto shrink-0 ${isAllowed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {isAllowed ? 'allowed' : 'denied'}
        </span>
      </div>
    );
  }

  // Pending state — card with vertical action buttons
  return (
    <div className={`my-1.5 rounded-md border ${borderColor} ${bgColor} overflow-hidden`}>
      {/* Tool info row */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Shield className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-mono font-semibold">{toolName}</span>
        {contextLine && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground font-mono truncate">{contextLine}</span>
          </>
        )}
        <span className="ml-auto relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500/75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
        </span>
      </div>

      {/* Command preview — only for Bash/shell */}
      {command && (
        <div className="mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono truncate">
          $ {command}
        </div>
      )}

      {/* Diff preview — only for Edit */}
      {hasOldNew && (
        <div className="mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono max-h-[80px] overflow-y-auto">
          {context.oldString && (
            <div className="text-red-400 whitespace-pre-wrap break-all">
              {context.oldString.split('\n').slice(0, 3).map((line, i) => (
                <div key={i}>- {line}</div>
              ))}
            </div>
          )}
          {context.newString && (
            <div className="text-emerald-400 whitespace-pre-wrap break-all">
              {context.newString.split('\n').slice(0, 3).map((line, i) => (
                <div key={i}>+ {line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content preview — only for Write */}
      {context.preview && !hasOldNew && !command && (
        <div className="mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono truncate">
          {context.preview.slice(0, 80)}
        </div>
      )}

      {/* Action buttons — vertical stack */}
      <div className="flex flex-col border-t border-inherit divide-y divide-inherit">
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium min-h-[44px] hover:bg-primary/10 transition-colors text-foreground text-left"
          onClick={() => handleClick('allow_once')}
          disabled={submitting}
        >
          <Check className="h-3.5 w-3.5 shrink-0" />
          Allow once
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium min-h-[44px] hover:bg-primary/10 transition-colors text-muted-foreground text-left"
          onClick={() => handleClick('allow_always')}
          disabled={submitting}
        >
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{allowAlwaysLabel}</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium min-h-[44px] hover:bg-red-500/10 transition-colors text-red-600 dark:text-red-400 text-left"
          onClick={() => handleClick('deny')}
          disabled={submitting}
        >
          <X className="h-3.5 w-3.5 shrink-0" />
          Deny
        </button>
      </div>
    </div>
  );
}

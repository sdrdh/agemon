import { useState } from 'react';
import { Shield, Check, X, ShieldCheck, ShieldX } from 'lucide-react';
import type { PendingApproval, ApprovalDecision } from '@agemon/shared';

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (approvalId: string, decision: ApprovalDecision) => void;
  connected: boolean;
}

export function ApprovalCard({ approval, onDecision, connected }: ApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isPending = approval.status === 'pending';
  const isAllowed = approval.decision === 'allow_once' || approval.decision === 'allow_always';

  const handleClick = (decision: ApprovalDecision) => {
    if (submitting || !isPending) return;
    setSubmitting(true);
    onDecision(approval.id, decision);
  };

  const { context, toolName, toolTitle } = approval;
  const filePath = context.filePath || context.path || '';
  const command = context.command || '';
  const hasOldNew = context.oldString || context.newString;

  // Compact context line: "fetch · exe.dev platform 2026" or "Edit · src/App.tsx"
  const contextLine = filePath || (toolTitle !== toolName ? toolTitle : '');

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
            <span
              className={`text-muted-foreground cursor-pointer ${expanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}
              onClick={() => setExpanded((e) => !e)}
            >{contextLine}</span>
          </>
        )}
        <span className={`ml-auto shrink-0 ${isAllowed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {isAllowed ? 'allowed' : 'denied'}
        </span>
      </div>
    );
  }

  // Pending state — compact card with inline buttons
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
        <div
          className={`mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono cursor-pointer ${expanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}
          onClick={() => setExpanded((e) => !e)}
        >
          $ {command}
        </div>
      )}

      {/* Diff preview — only for Edit */}
      {hasOldNew && (
        <div
          className={`mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono cursor-pointer ${expanded ? 'max-h-none' : 'max-h-[80px]'} overflow-y-auto`}
          onClick={() => setExpanded((e) => !e)}
        >
          {context.oldString && (
            <div className="text-red-400 whitespace-pre-wrap break-all">
              {(expanded ? context.oldString.split('\n') : context.oldString.split('\n').slice(0, 3)).map((line, i) => (
                <div key={i}>- {line}</div>
              ))}
            </div>
          )}
          {context.newString && (
            <div className="text-emerald-400 whitespace-pre-wrap break-all">
              {(expanded ? context.newString.split('\n') : context.newString.split('\n').slice(0, 3)).map((line, i) => (
                <div key={i}>+ {line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content preview — only for Write */}
      {context.preview && !hasOldNew && !command && (
        <div
          className={`mx-2.5 mb-1.5 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono cursor-pointer ${expanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? context.preview : context.preview.slice(0, 80)}
        </div>
      )}

      {/* Action buttons — compact row */}
      <div className="flex border-t border-inherit">
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium min-h-[36px] hover:bg-primary/10 transition-colors text-foreground"
          onClick={() => handleClick('allow_once')}
          disabled={submitting || !connected}
        >
          <Check className="h-3 w-3" />
          Allow
        </button>
        <span className="w-px bg-inherit border-l border-inherit" />
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium min-h-[36px] hover:bg-primary/10 transition-colors text-muted-foreground"
          onClick={() => handleClick('allow_always')}
          disabled={submitting || !connected}
        >
          <ShieldCheck className="h-3 w-3" />
          Always
        </button>
        <span className="w-px bg-inherit border-l border-inherit" />
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium min-h-[36px] hover:bg-red-500/10 transition-colors text-red-600 dark:text-red-400"
          onClick={() => handleClick('deny')}
          disabled={submitting || !connected}
        >
          <X className="h-3 w-3" />
          Deny
        </button>
      </div>
    </div>
  );
}

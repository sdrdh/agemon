import { useState } from 'react';
import { Shield, Check, X, ShieldCheck, ShieldX } from 'lucide-react';
import type { PendingApproval, ApprovalDecision, ApprovalOption } from '@agemon/shared';

/** Map option kind → icon, text color, and hover bg for the button. */
function optionStyle(kind: string) {
  switch (kind) {
    case 'allow_once':
      return { Icon: Check, text: 'text-foreground', hover: 'hover:bg-primary/10' };
    case 'allow_always':
      return { Icon: ShieldCheck, text: 'text-muted-foreground', hover: 'hover:bg-primary/10' };
    case 'deny':
      return { Icon: X, text: 'text-destructive', hover: 'hover:bg-destructive/10' };
    default:
      return { Icon: Check, text: 'text-foreground', hover: 'hover:bg-primary/10' };
  }
}

/** Fallback options when the server doesn't provide any (backward compat). */
const FALLBACK_OPTIONS: ApprovalOption[] = [
  { kind: 'allow_once', optionId: '', label: 'Allow' },
  { kind: 'allow_always', optionId: '', label: 'Always Allow' },
  { kind: 'deny', optionId: '', label: 'Deny' },
];

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
    ? 'border-warning/50'
    : isAllowed
      ? 'border-success/30'
      : 'border-destructive/30';

  const bgColor = isPending
    ? 'bg-warning/10'
    : isAllowed
      ? 'bg-success/10'
      : 'bg-destructive/10';

  const options = approval.options?.length > 0 ? approval.options : FALLBACK_OPTIONS;

  // Resolved state — single compact line
  if (!isPending) {
    return (
      <div className={`my-1 flex items-center gap-2 rounded-md border ${borderColor} ${bgColor} px-2.5 py-1.5 text-xs`}>
        {isAllowed
          ? <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
          : <ShieldX className="h-3.5 w-3.5 text-destructive shrink-0" />
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
        <span className={`ml-auto shrink-0 ${isAllowed ? 'text-success' : 'text-destructive'}`}>
          {isAllowed ? 'allowed' : 'denied'}
        </span>
      </div>
    );
  }

  // Pending state — compact card with option list
  return (
    <div className={`my-1.5 rounded-md border ${borderColor} ${bgColor} overflow-hidden`}>
      {/* Tool info row */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Shield className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-xs font-mono font-semibold">{toolName}</span>
        {contextLine && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground font-mono truncate">{contextLine}</span>
          </>
        )}
        <span className="ml-auto relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning/75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-warning" />
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
            <div className="text-destructive whitespace-pre-wrap break-all">
              {(expanded ? context.oldString.split('\n') : context.oldString.split('\n').slice(0, 3)).map((line, i) => (
                <div key={i}>- {line}</div>
              ))}
            </div>
          )}
          {context.newString && (
            <div className="text-success whitespace-pre-wrap break-all">
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

      {/* Action options — vertical list */}
      <div className="border-t border-inherit">
        {options.map((opt) => {
          const { Icon, text, hover } = optionStyle(opt.kind);
          return (
            <button
              key={opt.optionId || opt.kind}
              type="button"
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium min-h-[44px] ${hover} transition-colors ${text} border-b border-inherit last:border-b-0`}
              onClick={() => handleClick(opt.kind as ApprovalDecision)}
              disabled={submitting || !connected}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-left">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

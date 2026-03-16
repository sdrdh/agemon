import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, Check, X, Loader2, Brain, Wrench, Zap, Shield } from 'lucide-react';
import { parseActivityMessages, shortenToolLabel } from '@/lib/chat-utils';
import { ApprovalCard } from '@/components/custom/approval-card';
import type { ToolCallEntry } from '@/lib/chat-utils';
import type { ChatMessage, PendingApproval, ApprovalDecision } from '@agemon/shared';

const PREVIEW_COUNT = 2;

/** Render a one-line detail string for a tool call based on its kind and args. */
function toolDetail(tc: ToolCallEntry): string | null {
  if (!tc.args) return null;
  const a = tc.args;
  switch (tc.toolKind) {
    case 'Bash':
      return a.command ? truncate(a.command, 80) : null;
    case 'Read':
    case 'Write':
    case 'Edit':
      return a.filePath ? shortPath(a.filePath) : null;
    case 'Grep':
      return a.pattern ? `/${a.pattern}/` + (a.path ? ` in ${shortPath(a.path)}` : '') : null;
    case 'Glob':
      return a.pattern ?? null;
    case 'WebSearch':
      return a.command ?? a.pattern ?? null;
    case 'WebFetch':
      return a.url ? truncate(a.url, 60) : null;
    case 'Agent':
      return a.preview ? truncate(a.preview, 60) : null;
    default:
      return a.filePath ? shortPath(a.filePath) : a.command ? truncate(a.command, 60) : null;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? '\u2026/' + parts.slice(-2).join('/') : p;
}

export function ActivityGroup({
  messages,
  isLast,
  approvalLookup,
  onApprovalDecision,
}: {
  messages: ChatMessage[];
  isLast: boolean;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { toolCalls, thoughts } = useMemo(() => {
    const result = parseActivityMessages(messages);
    if (!isLast) {
      for (const tc of result.toolCalls) {
        if (tc.status === 'pending') tc.status = 'completed';
      }
    }
    return result;
  }, [messages, isLast]);

  // Separate approval messages from regular thoughts
  const approvalMessages = useMemo(
    () => thoughts.filter(m => m.eventType === 'approval_request'),
    [thoughts],
  );
  const regularThoughts = useMemo(
    () => thoughts.filter(m => m.eventType !== 'approval_request'),
    [thoughts],
  );

  // Force-expand when there's a pending approval that needs action
  const hasPendingApproval = useMemo(() => {
    if (!approvalLookup || approvalMessages.length === 0) return false;
    return approvalMessages.some(m => {
      const firstColon = m.content.indexOf(':');
      const approvalId = firstColon >= 0 ? m.content.slice(0, firstColon) : m.content;
      return approvalLookup.get(approvalId)?.status === 'pending';
    });
  }, [approvalMessages, approvalLookup]);

  useEffect(() => {
    if (hasPendingApproval) setExpanded(true);
  }, [hasPendingApproval]);

  // expanded OR force-open for pending approvals
  const isExpanded = expanded || hasPendingApproval;

  const completedCount = toolCalls.filter((tc) => tc.status === 'completed').length;
  const failedCount = toolCalls.filter((tc) => tc.status === 'failed').length;
  const pendingCount = toolCalls.filter((tc) => tc.status === 'pending').length;

  let statusSuffix = '';
  if (toolCalls.length > 0 && pendingCount === 0) {
    if (failedCount === 0) {
      statusSuffix = ' \u00b7 all passed';
    } else {
      const sp: string[] = [];
      if (completedCount > 0) sp.push(`${completedCount} passed`);
      if (failedCount > 0) sp.push(`${failedCount} failed`);
      statusSuffix = ` \u00b7 ${sp.join(', ')}`;
    }
  }

  const borderColor = failedCount > 0 ? 'border-red-400/50' : 'border-muted';

  // Show last PREVIEW_COUNT tool calls in the header; hide the rest behind expand
  const previewCalls = toolCalls.slice(-PREVIEW_COUNT);
  const hiddenCount = Math.max(0, toolCalls.length - PREVIEW_COUNT);

  return (
    <div
      className={`border-l-2 ${borderColor} pl-3 my-1 cursor-pointer select-none`}
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
      {/* Collapsed summary with rotating chevron */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-h-[44px] min-w-0">
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Preview of last 1-2 tool calls */}
          {previewCalls.map((tc) => (
            <span key={tc.id} className="flex items-center gap-1 min-w-0">
              {tc.kind === 'skill' ? (
                <Zap className="h-3 w-3 text-amber-500 shrink-0" />
              ) : (
                <Wrench className="h-3 w-3 shrink-0 opacity-50" />
              )}
              {tc.status === 'completed' && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
              {tc.status === 'failed' && <X className="h-3 w-3 text-red-500 shrink-0" />}
              {tc.status === 'pending' && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
              <span className="font-mono text-xs truncate max-w-[100px]">{shortenToolLabel(tc.label)}</span>
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="text-xs text-muted-foreground/60">+{hiddenCount}</span>
          )}
          {regularThoughts.length > 0 && (
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3 shrink-0" />
              <span className="text-xs">{regularThoughts.length} thought{regularThoughts.length !== 1 ? 's' : ''}</span>
            </span>
          )}
          {approvalMessages.length > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <Shield className="h-3 w-3 shrink-0" />
              <span className="text-xs">{approvalMessages.length} approval{approvalMessages.length !== 1 ? 's' : ''}</span>
            </span>
          )}
          {statusSuffix && (
            <span className={`text-xs ${failedCount > 0 ? 'text-red-400' : 'text-emerald-500'}`}>{statusSuffix}</span>
          )}
        </div>
      </div>

      {/* Animated expanded detail view using CSS grid */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
            {toolCalls.map((tc) => {
              const detail = toolDetail(tc);
              return (
                <div key={tc.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground min-w-0">
                  {tc.kind === 'skill' ? (
                    <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  )}
                  {tc.status === 'completed' && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  {tc.status === 'failed' && <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                  {tc.status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                  <span className="font-mono truncate">{shortenToolLabel(tc.label)}</span>
                  {detail && (
                    <span className="font-mono text-xs text-muted-foreground/60 truncate">{detail}</span>
                  )}
                </div>
              );
            })}
            {/* Approval cards */}
            {approvalMessages.length > 0 && (
              <div className="mt-1 space-y-1">
                {approvalMessages.map((m) => {
                  const firstColon = m.content.indexOf(':');
                  const secondColon = firstColon >= 0 ? m.content.indexOf(':', firstColon + 1) : -1;
                  const approvalId = firstColon >= 0 ? m.content.slice(0, firstColon) : m.content;
                  const toolName = secondColon >= 0 ? m.content.slice(secondColon + 1) : undefined;
                  if (approvalLookup && onApprovalDecision) {
                    const approval = approvalLookup.get(approvalId);
                    if (approval) {
                      return <ApprovalCard key={m.id} approval={approval} onDecision={onApprovalDecision} />;
                    }
                  }
                  return (
                    <div key={m.id} className="flex justify-center my-1">
                      <span className="text-xs text-muted-foreground italic">{toolName ?? 'Tool approval'} — loading…</span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Thoughts */}
            {regularThoughts.length > 0 && (
              <div className="mt-1.5 space-y-1 border-t border-muted/50 pt-1.5">
                {regularThoughts.map((m) => (
                  <div key={m.id} className="flex items-start gap-1.5 text-xs text-muted-foreground/70 break-words">
                    <Brain className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-50" />
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

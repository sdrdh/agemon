import { memo, useState, useMemo } from 'react';
import { ChevronRight, Brain, Wrench, Zap, Shield } from 'lucide-react';
import { ToolStatusIcon } from '@/components/custom/tool-cards/tool-icons';
import { parseActivityMessages, shortenToolLabel, extractApprovalId } from '@/lib/chat-utils';
import { ToolCardShell } from '@/components/custom/tool-cards/tool-card-shell';
import { ApprovalCard } from '@/components/custom/approval-card';
import { useWsStore } from '@/lib/store';
import { EMPTY_TOOL_CALLS } from '@/lib/tool-call-helpers';
import type { ToolCallEntry } from '@/lib/chat-utils';
import type { ChatMessage, PendingApproval, ApprovalDecision } from '@agemon/shared';

const noopDecision = () => {};

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

export const ActivityGroup = memo(function ActivityGroup({
  messages,
  isLast,
  sessionId,
  approvalLookup,
  onApprovalDecision,
  connected,
}: {
  messages: ChatMessage[];
  isLast: boolean;
  sessionId?: string | null;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
  connected?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const storeToolCalls = useWsStore((s) =>
    sessionId ? (s.toolCalls[sessionId] ?? EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS
  );
  const toolCallMap = useMemo(
    () => new Map(storeToolCalls.map((tc) => [tc.toolCallId, tc])),
    [storeToolCalls],
  );

  // Separate approval messages from tool/thought messages
  const { toolMessages, approvalMessages } = useMemo(() => {
    const tool: ChatMessage[] = [];
    const approval: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.eventType === 'approval_request') {
        approval.push(msg);
      } else if (msg.eventType !== 'approval_resolved') {
        // approval_resolved is just a status update — skip it, the request has the data
        tool.push(msg);
      }
    }
    return { toolMessages: tool, approvalMessages: approval };
  }, [messages]);

  // Parse tool calls and thoughts
  const { toolCalls, thoughts, toolCount, skillCount, completedCount, failedCount, pendingCount } = useMemo(() => {
    const result = parseActivityMessages(toolMessages);
    let _toolCount = 0, _skillCount = 0, _completedCount = 0, _failedCount = 0, _pendingCount = 0;
    for (const tc of result.toolCalls) {
      if (!isLast && tc.status === 'pending') tc.status = 'completed';
      if (tc.kind === 'tool') _toolCount++;
      if (tc.kind === 'skill') _skillCount++;
      if (tc.status === 'completed') _completedCount++;
      if (tc.status === 'failed') _failedCount++;
      if (tc.status === 'pending') _pendingCount++;
    }
    return { ...result, toolCount: _toolCount, skillCount: _skillCount, completedCount: _completedCount, failedCount: _failedCount, pendingCount: _pendingCount };
  }, [toolMessages, isLast]);

  // Resolve approval statuses from store — split into pending vs resolved
  const { resolvedApprovals, pendingApprovals: pendingApprovalCards, allowed, denied, resolvedCount } = useMemo(() => {
    const lookup = approvalLookup ?? new Map<string, PendingApproval>();
    const resolved: PendingApproval[] = [];
    const pending: PendingApproval[] = [];
    let _allowed = 0, _denied = 0;
    for (const msg of approvalMessages) {
      const id = extractApprovalId(msg.content);
      const approval = lookup.get(id);
      if (!approval) continue;
      if (approval.status === 'pending') {
        pending.push(approval);
      } else {
        resolved.push(approval);
        if (approval.decision === 'deny') _denied++;
        else _allowed++;
      }
    }
    return { resolvedApprovals: resolved, pendingApprovals: pending, allowed: _allowed, denied: _denied, resolvedCount: resolved.length };
  }, [approvalMessages, approvalLookup]);

  const toolsDone = toolCalls.length > 0 && pendingCount === 0;
  const approvalsDone = resolvedCount > 0;

  const hasFailed = failedCount > 0 || denied > 0;
  const borderColor = hasFailed ? 'border-destructive/50' : 'border-muted';
  const totalItems = toolCalls.length + resolvedCount + thoughts.length;

  if (totalItems === 0 && pendingApprovalCards.length === 0) return null;

  // Only pending approvals, nothing to collapse — render them standalone
  if (totalItems === 0) {
    return (
      <div className="my-1" onClick={(e) => e.stopPropagation()}>
        {pendingApprovalCards.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onDecision={onApprovalDecision ?? noopDecision}
            connected={connected ?? true}
          />
        ))}
      </div>
    );
  }

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
      {/* Collapsed summary */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-h-[44px]">
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tool count + status */}
          {toolCount > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3 shrink-0" />
              <span>{toolCount} tool{toolCount !== 1 ? 's' : ''}</span>
            </span>
          )}
          {skillCount > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <Zap className="h-3 w-3 shrink-0" />
              <span>{skillCount} skill{skillCount !== 1 ? 's' : ''}</span>
            </span>
          )}
          {toolsDone && (
            <span>
              {'· '}
              {completedCount > 0 && <span className="text-success">{completedCount} passed</span>}
              {completedCount > 0 && failedCount > 0 && ', '}
              {failedCount > 0 && <span className="text-destructive">{failedCount} failed</span>}
            </span>
          )}

          {/* Resolved approval count + status */}
          {resolvedCount > 0 && (
            <>
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3 shrink-0" />
                <span>{resolvedCount} approval{resolvedCount !== 1 ? 's' : ''}</span>
              </span>
              {approvalsDone && (
                <span>
                  {'· '}
                  {allowed > 0 && <span className="text-emerald-400">{allowed} allowed</span>}
                  {allowed > 0 && denied > 0 && ', '}
                  {denied > 0 && <span className="text-destructive">{denied} denied</span>}
                </span>
              )}
            </>
          )}

          {/* Thoughts */}
          {thoughts.length > 0 && (
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3 shrink-0" />
              <span>{thoughts.length} thought{thoughts.length !== 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail view */}
      <div
        className="grid"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
            {/* Tool calls */}
            {toolCalls.map((tc) => {
              const storeTc = toolCallMap.get(tc.id);
              if (storeTc) {
                return <ToolCardShell key={tc.id} toolCall={storeTc} condensed />;
              }
              const detail = toolDetail(tc);
              const fallbackStatus = tc.status === 'pending' ? 'pending' : tc.status === 'failed' ? 'failed' : 'completed';
              return (
                <div key={tc.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground min-w-0">
                  <ToolStatusIcon kind={tc.toolKind ?? 'unknown'} status={fallbackStatus} />
                  <span className="font-mono truncate">{shortenToolLabel(tc.label)}</span>
                  {detail && (
                    <span className="font-mono text-xs text-muted-foreground/60 truncate">{detail}</span>
                  )}
                </div>
              );
            })}

            {/* Resolved approval cards */}
            {resolvedApprovals.length > 0 && (
              <div className={toolCalls.length > 0 ? 'mt-1.5 border-t border-muted/50 pt-1.5' : ''}>
                {resolvedApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onDecision={onApprovalDecision ?? noopDecision}
                    connected={connected ?? true}
                  />
                ))}
              </div>
            )}

            {/* Thoughts */}
            {thoughts.length > 0 && (
              <div className="mt-1.5 space-y-1 border-t border-muted/50 pt-1.5">
                {thoughts.map((m) => (
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

      {/* Pending approvals — always visible, outside collapsed section */}
      {pendingApprovalCards.length > 0 && (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
          {pendingApprovalCards.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onDecision={onApprovalDecision ?? noopDecision}
              connected={connected ?? true}
            />
          ))}
        </div>
      )}
    </div>
  );
});

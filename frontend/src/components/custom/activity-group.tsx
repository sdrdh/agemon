import { memo, useState, useMemo } from 'react';
import { ChevronRight, Brain, Wrench, Zap } from 'lucide-react';
import { ToolStatusIcon } from '@/components/custom/tool-cards/tool-icons';
import { parseActivityMessages, shortenToolLabel } from '@/lib/chat-utils';
import { ToolCardShell } from '@/components/custom/tool-cards/tool-card-shell';
import { useWsStore } from '@/lib/store';
import { EMPTY_TOOL_CALLS } from '@/lib/tool-call-helpers';
import type { ToolCallEntry } from '@/lib/chat-utils';
import type { ChatMessage } from '@agemon/shared';

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
      // Generic: show filePath or command if available
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

export const ActivityGroup = memo(function ActivityGroup({ messages, isLast, sessionId }: { messages: ChatMessage[]; isLast: boolean; sessionId?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const storeToolCalls = useWsStore((s) =>
    sessionId ? (s.toolCalls[sessionId] ?? EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS
  );
  const toolCallMap = useMemo(
    () => new Map(storeToolCalls.map((tc) => [tc.toolCallId, tc])),
    [storeToolCalls],
  );
  const { toolCalls, thoughts, toolCount, skillCount, completedCount, failedCount, pendingCount } = useMemo(() => {
    const result = parseActivityMessages(messages);
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
  }, [messages, isLast]);

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

  const borderColor = failedCount > 0 ? 'border-destructive/50' : 'border-muted';

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
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-h-[44px]">
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="flex items-center gap-2 flex-wrap">
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
          {thoughts.length > 0 && (
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3 shrink-0" />
              <span>{thoughts.length} thought{thoughts.length !== 1 ? 's' : ''}</span>
            </span>
          )}
          {statusSuffix && (
            <span className={failedCount > 0 ? 'text-destructive' : 'text-success'}>{statusSuffix}</span>
          )}
        </div>
      </div>

      {/* Animated expanded detail view using CSS grid */}
      <div
        className="grid"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
            {toolCalls.map((tc) => {
              // Try to render rich ToolCardShell if store has data for this tool call
              const storeTc = toolCallMap.get(tc.id);
              if (storeTc) {
                return <ToolCardShell key={tc.id} toolCall={storeTc} condensed />;
              }
              // Fallback: flat line rendering (legacy or no store data)
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
    </div>
  );
});

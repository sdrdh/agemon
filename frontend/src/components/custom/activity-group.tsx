import { useState, useMemo } from 'react';
import { ChevronRight, Check, X, Loader2, Brain, Wrench, Zap } from 'lucide-react';
import { parseActivityMessages, shortenToolLabel } from '@/lib/chat-utils';
import type { ChatMessage } from '@agemon/shared';

export function ActivityGroup({ messages, isLast }: { messages: ChatMessage[]; isLast: boolean }) {
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

  const toolCount = toolCalls.filter((tc) => tc.kind === 'tool').length;
  const skillCount = toolCalls.filter((tc) => tc.kind === 'skill').length;
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
            <span className="flex items-center gap-1 text-amber-500">
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
            <span className={failedCount > 0 ? 'text-red-400' : 'text-emerald-500'}>{statusSuffix}</span>
          )}
        </div>
      </div>

      {/* Animated expanded detail view using CSS grid */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
            {toolCalls.map((tc) => (
              <div key={tc.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
                {tc.kind === 'skill' ? (
                  <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Wrench className="h-3.5 w-3.5 shrink-0 opacity-50" />
                )}
                {tc.status === 'completed' && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                {tc.status === 'failed' && <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                {tc.status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                <span className="font-mono truncate">{shortenToolLabel(tc.label)}</span>
              </div>
            ))}
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
}

import { useState, useMemo } from 'react';
import { ChevronRight, Check, X, Loader2, Brain, Wrench, Zap } from 'lucide-react';
import { parseActivityMessages, shortenToolLabel } from '@/lib/chat-utils';
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

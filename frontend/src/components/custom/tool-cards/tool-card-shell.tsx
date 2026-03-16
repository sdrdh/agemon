import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolCall } from '@/lib/store';
import { getToolCardComponent } from './index';
import { ToolStatusIcon } from './tool-icons';

export interface ToolCardContentProps {
  toolCall: ToolCall;
}

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? '\u2026/' + parts.slice(-2).join('/') : p;
}

function getSummary(toolCall: ToolCall): string {
  const a = toolCall.args;
  switch (toolCall.kind) {
    case 'Bash':
    case 'bash':
      return a.command ? (a.command.length > 80 ? a.command.slice(0, 79) + '\u2026' : a.command) : '';
    case 'Read':
    case 'Write':
    case 'Edit':
      return a.filePath ? shortPath(a.filePath) : '';
    case 'Grep':
      return a.pattern ? `/${a.pattern}/` + (a.path ? ` in ${shortPath(a.path)}` : '') : '';
    case 'Glob':
      return a.pattern ?? '';
    case 'WebSearch':
    case 'web_search':
      return a.command ?? a.pattern ?? '';
    default:
      return a.filePath ? shortPath(a.filePath) : a.command ? (a.command.length > 60 ? a.command.slice(0, 59) + '\u2026' : a.command) : '';
  }
}

export function ToolCardShell({ toolCall, condensed }: { toolCall: ToolCall; condensed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const Content = getToolCardComponent(toolCall.kind);
  const summary = getSummary(toolCall);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const hasDetail = !!(toolCall.output || toolCall.error || toolCall.display);

  return (
    <div
      className={`border rounded-lg ${condensed ? 'my-0.5' : 'my-1'} ${toolCall.error ? 'border-destructive/50' : 'border-muted'} bg-card`}
    >
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((e) => !e)}
        className={`flex items-center gap-2 w-full text-left ${condensed ? 'px-2 py-1.5' : 'px-3 py-2'} min-h-[44px] text-sm`}
      >
        {/* Tool icon colored by status */}
        <ToolStatusIcon kind={toolCall.kind} status={toolCall.status} />

        {/* Tool badge */}
        <span className="font-mono text-xs font-medium bg-muted px-1.5 py-0.5 rounded shrink-0">
          {toolCall.kind}
        </span>

        {/* Summary */}
        <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-0">
          {summary}
        </span>

        {/* Duration */}
        <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
          {duration}
        </span>

        {/* Expand chevron */}
        {hasDetail && (
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {/* Expandable detail panel */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className={`border-t border-muted ${condensed ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
            <Content toolCall={toolCall} />
          </div>
        </div>
      </div>
    </div>
  );
}

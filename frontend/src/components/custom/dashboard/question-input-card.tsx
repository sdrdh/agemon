import { useState } from 'react';
import { Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { agentDisplayName } from '@/components/custom/agent-icons';
import { formatRelativeTime } from '@/lib/time-utils';
import type { PendingInput } from '@/lib/store';

interface QuestionInputCardProps {
  input: PendingInput;
  taskName: string;
  taskDescription?: string;
  lastMessage?: { text: string; role: 'agent' | 'user' };
  agentType: string;
  connected: boolean;
  onSubmit: (inputId: string, taskId: string, response: string) => void;
  onNavigate: () => void;
}

export function QuestionInputCard({
  input,
  taskName,
  taskDescription,
  lastMessage,
  agentType,
  connected,
  onSubmit,
  onNavigate,
}: QuestionInputCardProps) {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const hasContext = !!taskDescription || !!lastMessage;

  const handleSubmit = () => {
    if (!text.trim() || !connected) return;
    onSubmit(input.inputId, input.taskId, text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const timestamp = formatRelativeTime(new Date(input.receivedAt).toISOString());

  return (
    <div
      className="rounded-lg bg-card border-l-4 border-blue-400 overflow-hidden cursor-pointer"
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
            className="text-xs border-blue-400/50 bg-blue-500/10 text-blue-500 font-semibold"
          >
            💬 QUESTION
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">{timestamp}</span>
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

      {/* Question text */}
      <div className="px-3 pb-2">
        <p className="text-sm text-foreground">{input.question}</p>
      </div>

      {/* Response input — stop click propagation */}
      <div
        className="px-3 pb-3 flex gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your response..."
          className="flex-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={!connected}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!connected || !text.trim()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send response"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

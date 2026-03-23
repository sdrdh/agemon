import { useState } from 'react';
import { Send, Square, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { agentDisplayName } from '@/components/custom/agent-icons';
import { formatRelativeTime } from '@/lib/time-utils';
import type { DashboardIdleSession } from '@agemon/shared';

interface IdleSessionCardProps {
  entry: DashboardIdleSession;
  connected: boolean;
  onSendMessage: (sessionId: string, content: string) => void;
  onStop: (sessionId: string) => void;
  onArchive: (sessionId: string) => void;
  onNavigate: () => void;
}

export function IdleSessionCard({
  entry,
  connected,
  onSendMessage,
  onStop,
  onArchive,
  onNavigate,
}: IdleSessionCardProps) {
  const [text, setText] = useState('');
  const { session, task, lastAgentMessage } = entry;

  const handleSubmit = () => {
    if (!text.trim() || !connected) return;
    onSendMessage(session.id, text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const truncatedMessage = lastAgentMessage
    ? lastAgentMessage.length > 150 ? lastAgentMessage.slice(0, 150) + '...' : lastAgentMessage
    : null;

  return (
    <div
      className="rounded-lg bg-card border-l-4 border-success overflow-hidden cursor-pointer"
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) onNavigate(); }}
    >
      <div className="px-3 pt-3 pb-1">
        {/* Top line: badge + actions + timestamp */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <Badge
            variant="outline"
            className="text-xs border-success/50 bg-success/10 text-success font-semibold"
          >
            IDLE
          </Badge>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
              disabled={!connected}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              aria-label="Stop session"
              title="Stop"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onArchive(session.id); }}
              disabled={!connected}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
              aria-label="Archive session"
              title="Archive"
            >
              <Archive className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Second line: task + agent + duration */}
        <p className="text-xs text-muted-foreground truncate">
          {task.title} · {agentDisplayName(session.agent_type)} · {formatRelativeTime(session.started_at)}
        </p>

        {/* Last agent message */}
        {truncatedMessage && (
          <p className="text-xs text-foreground/60 mt-1.5 line-clamp-2">
            {truncatedMessage}
          </p>
        )}
      </div>

      {/* Inline message input */}
      <div
        className="px-3 pb-3 flex gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="flex-1 min-h-[44px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          disabled={!connected}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!connected || !text.trim()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

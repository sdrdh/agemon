import { memo, useState, useEffect } from 'react';
import { Square } from 'lucide-react';
import type { AgentSession } from '@agemon/shared';
import { useWsStore } from '@/lib/store';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { formatMs } from '@/lib/time-utils';


interface SessionActivityCardProps {
  session: AgentSession;
  taskName: string;
  onNavigate?: () => void;
  onStop?: (sessionId: string) => void;
}

export const SessionActivityCard = memo(function SessionActivityCard({
  session,
  taskName,
  onNavigate,
  onStop,
}: SessionActivityCardProps) {
  // Subscribe only to this session's activity — avoids re-rendering siblings
  const activity = useWsStore((s) => s.agentActivity[session.id] ?? null);
  // Tick every 30s to keep the duration updating
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const durationMs = Date.now() - new Date(session.started_at).getTime();
  const agentColor = AGENT_COLORS[session.agent_type] ?? 'text-foreground';

  return (
    <div
      className="rounded-lg bg-card border border-border p-3 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (onNavigate && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onNavigate();
        }
      }}
    >
      {/* Top row: task name + agent + duration */}
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-xs text-muted-foreground truncate flex-1">{taskName}</span>
        <span className={`flex items-center gap-1 text-xs shrink-0 ${agentColor}`}>
          <AgentIcon agentType={session.agent_type} className="h-3.5 w-3.5" />
          {agentDisplayName(session.agent_type)}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{formatMs(durationMs)}</span>
      </div>

      {/* Session name + running indicator + stop */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-sm truncate flex-1">{session.name ?? 'Unnamed session'}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-xs text-success font-medium">Running</span>
        </span>
        {onStop && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            aria-label="Stop session"
            title="Stop"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        )}
      </div>

      {/* Activity line */}
      <div className="bg-muted rounded-lg p-2 mb-2">
        <p className="text-xs text-muted-foreground truncate">
          {activity ?? 'Waiting...'}
        </p>
      </div>

    </div>
  );
});

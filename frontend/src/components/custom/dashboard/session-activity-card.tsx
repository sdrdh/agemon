import { useState, useEffect } from 'react';
import type { AgentSession, SessionUsage } from '@agemon/shared';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { formatMs } from '@/lib/time-utils';

interface SessionActivityCardProps {
  session: AgentSession;
  taskName: string;
  activity: string | null;
  usage: SessionUsage | undefined;
  onNavigate: () => void;
}

export function SessionActivityCard({
  session,
  taskName,
  activity,
  usage,
  onNavigate,
}: SessionActivityCardProps) {
  // Tick every 30s to keep the duration updating
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const durationMs = Date.now() - new Date(session.started_at).getTime();
  const agentColor = AGENT_COLORS[session.agent_type] ?? 'text-foreground';
  const totalTokens = usage ? (usage.inputTokens + usage.outputTokens).toLocaleString() : null;

  return (
    <div
      className="rounded-lg bg-card p-3 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate(); }}
    >
      {/* Top row: task name + agent + duration */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-sm truncate flex-1">{taskName}</span>
        <span className={`flex items-center gap-1 text-xs shrink-0 ${agentColor}`}>
          <AgentIcon agentType={session.agent_type} className="h-3.5 w-3.5" />
          {agentDisplayName(session.agent_type)}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{formatMs(durationMs)}</span>
      </div>

      {/* Running indicator row */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-xs text-emerald-500 font-medium">Running</span>
      </div>

      {/* Activity line */}
      <div className="bg-muted rounded-lg p-2 mb-2">
        <p className="text-xs text-muted-foreground truncate">
          {activity ?? 'Waiting...'}
        </p>
      </div>

      {/* Token count + cost */}
      {usage && (
        <p className="text-xs text-muted-foreground">
          {totalTokens} tokens
          {usage.cost != null ? ` · $${usage.cost.toFixed(2)}` : ''}
        </p>
      )}
    </div>
  );
}

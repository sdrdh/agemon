import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionsListQuery, tasksListQuery } from '@/lib/query';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/custom/status-badge';
import type { AgentSession, AgentSessionState, Task } from '@agemon/shared';

const STATE_STYLES: Record<AgentSessionState, { label: string; className: string }> = {
  starting: {
    label: 'Starting',
    className: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  ready: {
    label: 'Ready',
    className: 'border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  },
  running: {
    label: 'Running',
    className: 'border-transparent bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  stopped: {
    label: 'Stopped',
    className: 'border-transparent bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  crashed: {
    label: 'Crashed',
    className: 'border-transparent bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
  interrupted: {
    label: 'Interrupted',
    className: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
};

// Groups in display order: active states first, then terminal
const STATE_GROUPS: { label: string; states: AgentSessionState[] }[] = [
  { label: 'Active', states: ['running', 'ready', 'starting'] },
  { label: 'Stopped', states: ['stopped', 'interrupted', 'crashed'] },
];

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  if (endedAt) {
    const end = new Date(endedAt).getTime();
    return formatMs(end - start);
  }
  return 'running';
}

function formatMs(ms: number): string {
  if (ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SessionStateBadge({ state }: { state: AgentSessionState }) {
  const style = STATE_STYLES[state];
  return <Badge className={style.className}>{style.label}</Badge>;
}

function SessionRow({
  session,
  task,
  onClick,
}: {
  session: AgentSession;
  task: Task | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-3 min-h-[52px] border-b last:border-b-0 hover:bg-accent/50 active:bg-accent/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Task title + task status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {task?.title ?? `Task ${session.task_id.slice(0, 8)}`}
            </span>
            {task && <StatusBadge status={task.status} />}
          </div>
          {/* Session name + agent type + session badge + timestamp */}
          <div className="flex items-center gap-2 mt-1">
            {session.name && (
              <span className="text-xs font-medium text-foreground/70 truncate max-w-[120px]">{session.name}</span>
            )}
            <span className="text-xs text-muted-foreground">{session.agent_type}</span>
            <SessionStateBadge state={session.state} />
            <span className="text-xs text-muted-foreground">{formatTime(session.started_at)}</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDuration(session.started_at, session.ended_at)}
        </div>
      </div>
    </button>
  );
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const { data: sessions, isLoading: sessionsLoading, error: sessionsError } = useQuery(sessionsListQuery());
  const { data: tasks } = useQuery(tasksListQuery());

  // Build task lookup by ID
  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks ?? []) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Group sessions by state group
  const grouped = useMemo(() => {
    if (!sessions) return [];
    const stateToGroup = new Map<AgentSessionState, number>();
    STATE_GROUPS.forEach((g, i) => g.states.forEach((s) => stateToGroup.set(s, i)));

    const buckets: AgentSession[][] = STATE_GROUPS.map(() => []);
    for (const s of sessions) {
      const idx = stateToGroup.get(s.state) ?? 1;
      buckets[idx].push(s);
    }
    return STATE_GROUPS.map((g, i) => ({ label: g.label, sessions: buckets[i] })).filter(
      (g) => g.sessions.length > 0,
    );
  }, [sessions]);

  if (sessionsLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (sessionsError) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">
          {sessionsError instanceof Error ? sessionsError.message : 'Failed to load sessions'}
        </p>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No agent sessions yet.</p>
        <p className="text-xs mt-1">Sessions appear when you start an agent on a task.</p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Agent Sessions</h1>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {sessions.length}
          </span>
        </div>
      </div>
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="px-4 py-2 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {group.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.sessions.length}
              </span>
            </div>
          </div>
          <div className="divide-y">
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                task={taskMap.get(session.task_id)}
                onClick={() =>
                  navigate({ to: '/tasks/$id', params: { id: session.task_id } })
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

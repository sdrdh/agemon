import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearch, useRouter } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, X, ArrowLeft } from 'lucide-react';
import { sessionsListQuery, taskSessionsQuery, tasksListQuery, sessionKeys } from '@/lib/query';
import { api } from '@/lib/api';
import { onServerEvent } from '@/lib/ws';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/custom/status-badge';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { friendlyError } from '@/lib/errors';
import { formatDuration } from '@/lib/time-utils';
import type { AgentSession, AgentSessionState, Task, ServerEvent } from '@agemon/shared';

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
    className: 'border-transparent bg-success/15 text-success',
  },
  stopped: {
    label: 'Stopped',
    className: 'border-transparent bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  crashed: {
    label: 'Crashed',
    className: 'border-transparent bg-destructive/15 text-destructive',
  },
  interrupted: {
    label: 'Interrupted',
    className: 'border-transparent bg-warning/15 text-warning',
  },
};

// Groups in display order: active states first, then terminal
const STATE_GROUPS: { label: string; states: AgentSessionState[] }[] = [
  { label: 'Active', states: ['running', 'ready', 'starting'] },
  { label: 'Stopped', states: ['stopped', 'interrupted', 'crashed'] },
];

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
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 min-h-[52px] border-b last:border-b-0 hover:bg-accent/50 active:bg-accent/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${session.archived ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Task title + task status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {task?.title ?? (session.task_id ? `Task ${session.task_id.slice(0, 8)}` : 'Local session')}
            </span>
            {task && <StatusBadge status={task.status} />}
          </div>
          {/* Session name + agent type + session badge + timestamp */}
          <div className="flex items-center gap-2 mt-1">
            {session.name && (
              <span className="text-xs font-medium text-foreground/70 truncate max-w-[120px]">{session.name}</span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <AgentIcon agentType={session.agent_type} className={`h-3.5 w-3.5 ${AGENT_COLORS[session.agent_type] ?? ''}`} />
              {agentDisplayName(session.agent_type)}
            </span>
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

// ─── Raw Session Creation Form ────────────────────────────────────────────────

function NewSessionForm({ onClose, onCreated }: { onClose: () => void; onCreated: (session: AgentSession) => void }) {
  const [cwd, setCwd] = useState('');
  const [agentType, setAgentType] = useState('claude-code');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cwd.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.createRawSession({ cwd: trimmed, agentType });
      onCreated(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-b bg-muted/20 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">New Session</h2>
        <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="cwd" className="text-xs font-medium text-muted-foreground">Working directory</label>
          <input
            id="cwd"
            value={cwd}
            onChange={e => setCwd(e.target.value)}
            placeholder="/home/user/my-project"
            required
            className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agentType" className="text-xs font-medium text-muted-foreground">Agent</label>
          <select
            id="agentType"
            value={agentType}
            onChange={e => setAgentType(e.target.value)}
            className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="claude-code">Claude Code</option>
            <option value="opencode">OpenCode</option>
          </select>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={!cwd.trim() || submitting}
          className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create Session'}
        </button>
      </form>
    </div>
  );
}

// ─── SessionList — shared component ──────────────────────────────────────────

export function SessionList({ taskId }: { taskId?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const { data: allSessions, isLoading: allLoading, error: allError } = useQuery({
    ...sessionsListQuery(100, showArchived),
    enabled: !taskId,
  });
  const { data: filteredSessions, isLoading: filteredLoading, error: filteredError } = useQuery({
    ...taskSessionsQuery(taskId ?? '', showArchived),
    enabled: !!taskId,
  });
  const sessions = taskId ? filteredSessions : allSessions;
  const sessionsLoading = taskId ? filteredLoading : allLoading;
  const sessionsError = taskId ? filteredError : allError;

  // Only fetch task map when showing all sessions (not task-filtered)
  const { data: allTasks } = useQuery({
    ...tasksListQuery(true),
    enabled: !taskId,
  });

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of allTasks ?? []) map.set(t.id, t);
    return map;
  }, [allTasks]);

  // Live updates: refresh session list on session_state_changed
  useEffect(() => {
    const unsub = onServerEvent((event: ServerEvent) => {
      if (event.type !== 'session_state_changed') return;
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
      } else {
        queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      }
    });
    return () => { unsub(); };
  }, [taskId, queryClient]);

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

  const handleNewSession = async () => {
    if (taskId) {
      // Task-scoped: create immediately and navigate
      try {
        const session = await api.createSession(taskId);
        navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: session.id } });
      } catch (err) {
        console.error('Failed to create session:', err);
      }
    } else {
      setShowNewForm(true);
    }
  };

  const handleRawSessionCreated = (session: AgentSession) => {
    setShowNewForm(false);
    if (session.task_id) {
      navigate({ to: '/tasks/$id', params: { id: session.task_id }, search: { session: session.id } });
    } else {
      navigate({ to: '/sessions/$id', params: { id: session.id } });
    }
  };

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
          {friendlyError(sessionsError, 'Failed to load sessions')}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          {taskId && (
            <button
              type="button"
              onClick={() => router.history.back()}
              className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-muted"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h1 className="text-sm font-semibold">
            {taskId ? 'Task Sessions' : 'Agent Sessions'}
          </h1>
          {sessions && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {sessions.length}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs rounded-md transition-colors ${showArchived ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <button
            type="button"
            onClick={handleNewSession}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs rounded-md bg-primary text-primary-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
      </div>

      {showNewForm && !taskId && (
        <NewSessionForm
          onClose={() => setShowNewForm(false)}
          onCreated={handleRawSessionCreated}
        />
      )}

      {(!sessions || sessions.length === 0) && !showNewForm && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No agent sessions yet.</p>
          <p className="text-xs mt-1">Sessions appear when you start an agent on a task.</p>
        </div>
      )}

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
                task={session.task_id ? taskMap.get(session.task_id) : undefined}
                onClick={session.task_id
                  ? () => navigate({ to: '/tasks/$id', params: { id: session.task_id! }, search: { session: session.id } })
                  : () => navigate({ to: '/sessions/$id', params: { id: session.id } })
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Sessions page — thin wrapper ─────────────────────────────────────────────

export default function SessionsPage() {
  const { taskId } = useSearch({ from: '/sessions' });
  return <SessionList taskId={taskId} />;
}

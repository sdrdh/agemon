/**
 * Tasks plugin page — root component + internal SPA router.
 *
 * React/lucide-react are externalized (see build.ts) and come from
 * window.__AGEMON__ globals provided by the host app.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare,
  Plus,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Info,
  CheckCircle2,
  Archive,
  Diff,
} from 'lucide-react';

// ─── Internal router ─────────────────────────────────────────────────────────

const PREFIX = '/p/tasks';

function getPath(): string {
  const p = window.location.pathname;
  return p.startsWith(PREFIX) ? p.slice(PREFIX.length) || '/' : '/';
}

function navigate(path: string): void {
  window.history.pushState(null, '', PREFIX + (path === '/' ? '' : path));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ─── API base ────────────────────────────────────────────────────────────────

const API = '/api/plugins/tasks';

// ─── Inline types (no @agemon/shared import in browser bundle) ───────────────

type TaskStatus = 'todo' | 'working' | 'awaiting_input' | 'done';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  agent: string;
  archived: boolean;
  created_at: string;
}

// ─── Shared components ───────────────────────────────────────────────────────

const STATUS_CLASSES: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  working: 'bg-blue-500/10 text-blue-600',
  awaiting_input: 'bg-amber-500/10 text-amber-600',
  done: 'bg-green-500/10 text-green-600',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  working: 'Working',
  awaiting_input: 'Awaiting Input',
  done: 'Done',
};

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <button
      onClick={() => navigate(`/${task.id}`)}
      className="w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors min-h-[44px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
          )}
        </div>
        <StatusBadge status={task.status} />
      </div>
    </button>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

// ─── WS hook ─────────────────────────────────────────────────────────────────

function useWsEvent(handler: (event: Record<string, unknown>) => void, deps: unknown[]) {
  useEffect(() => {
    const unsub = (window as any).__AGEMON__?.onWsEvent?.(handler);
    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/tasks`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((data: Task[]) => setTasks(data.filter(t => !t.archived)))
      .catch(e => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, []);

  useWsEvent((event) => {
    if (event.type !== 'task_updated') return;
    const updated = event.task as Task;
    setTasks(prev => {
      if (updated.archived) return prev.filter(t => t.id !== updated.id);
      const idx = prev.findIndex(t => t.id === updated.id);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  const activeTasks = tasks.filter(t => t.status !== 'done');
  const doneTasks = tasks.filter(t => t.status === 'done');

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">Tasks</h1>
          {!loading && (
            <span className="text-xs text-muted-foreground">({tasks.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/kanban')}
            className="text-xs text-muted-foreground hover:text-foreground px-2 min-h-[44px] flex items-center"
          >
            Kanban
          </button>
          <button
            onClick={() => navigate('/new')}
            aria-label="New task"
            className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading && <SkeletonRows />}

      {error && (
        <div className="p-4 text-sm text-destructive">{error}</div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground text-sm mb-2">No tasks yet</p>
          <button
            onClick={() => navigate('/new')}
            className="text-primary text-sm underline min-h-[44px] px-2"
          >
            Create your first task
          </button>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="p-4 space-y-2">
          {activeTasks.map(task => <TaskRow key={task.id} task={task} />)}
          {doneTasks.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground px-1 mb-2">
                Done ({doneTasks.length})
              </p>
              {doneTasks.map(task => <TaskRow key={task.id} task={task} />)}
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => navigate('/new')}
        aria-label="Create new task"
        className="fixed bottom-20 right-4 z-40 h-[52px] w-[52px] rounded-2xl bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

// ─── Kanban ───────────────────────────────────────────────────────────────────

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'working', label: 'Working' },
  { status: 'awaiting_input', label: 'Awaiting Input' },
  { status: 'done', label: 'Done' },
];

function Kanban() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`${API}/tasks`, { credentials: 'include' })
      .then(r => r.json())
      .then((data: Task[]) => setTasks(data.filter(t => !t.archived)))
      .finally(() => setLoading(false));
  }, []);

  useWsEvent((event) => {
    if (event.type !== 'task_updated') return;
    const updated = event.task as Task;
    setTasks(prev => {
      if (updated.archived) return prev.filter(t => t.id !== updated.id);
      const idx = prev.findIndex(t => t.id === updated.id);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  const grouped: Record<TaskStatus, Task[]> = {
    todo: [], working: [], awaiting_input: [], done: [],
  };
  for (const task of tasks) grouped[task.status].push(task);

  const toggle = (status: string) =>
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] }));

  return (
    <div>
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px]"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold">Kanban</h1>
      </div>

      {loading && <SkeletonRows count={4} />}

      {!loading && (
        <div className="p-4 space-y-2">
          {COLUMNS.map(col => {
            const colTasks = grouped[col.status];
            const isCollapsed = collapsed[col.status] ?? colTasks.length === 0;
            return (
              <div key={col.status}>
                <button
                  type="button"
                  onClick={() => toggle(col.status)}
                  className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  {isCollapsed
                    ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="text-sm font-semibold flex-1 text-left">{col.label}</span>
                  <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
                    {colTasks.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-2 pt-2 pl-2">
                    {colTasks.map(task => <TaskRow key={task.id} task={task} />)}
                    {colTasks.length === 0 && (
                      <div className="rounded-lg border border-dashed border-muted-foreground/25 p-4 text-center text-xs text-muted-foreground">
                        No tasks
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Task Detail ──────────────────────────────────────────────────────────────

// ─── Task Info Drawer ──────────────────────────────────────────────────────────

function TaskInfoDrawer({
  task,
  open,
  onClose,
  onMarkDone,
  markingDone,
  isDone,
  onArchive,
  archiving,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onMarkDone: () => void;
  markingDone: boolean;
  isDone: boolean;
  onArchive: () => void;
  archiving: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const formattedDate = new Date(task.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[85vw] max-w-sm bg-background border-l shadow-xl transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="Task details"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-foreground">Task Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent/50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto h-[calc(100%-49px)] px-4 py-4 space-y-5">
          {task.description && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </section>
          )}

          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Info</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Agent</span>
                <span className="ml-auto text-xs">{task.agent}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto text-xs">{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Task ID</span>
                <span className="ml-auto font-mono text-xs truncate max-w-[140px]">{task.id}</span>
              </div>
            </div>
          </section>

          <section className="pt-2 border-t space-y-1">
            {!isDone && (
              <button
                type="button"
                onClick={onMarkDone}
                disabled={markingDone}
                className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark as done
              </button>
            )}
            <button
              type="button"
              onClick={onArchive}
              disabled={archiving}
              className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              Archive task
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Task Detail ──────────────────────────────────────────────────────────────

function TaskDetail({ id }: { id: string }) {
  const { SessionList, ChatPanel, StatusBadge: HostStatusBadge, DiffViewer } = (window as any).__AGEMON__?.host ?? {};
  const api = (window as any).__AGEMON__?.api;

  const [task, setTask] = useState<Task | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  // Read initial session from URL search params (passed by dashboard navigation)
  const [selectedSession, setSelectedSession] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
  });

  // Fetch task data
  useEffect(() => {
    if (!api?.getTask) return;
    setTaskLoading(true);
    setTaskError(null);
    api.getTask(id)
      .then((t: Task) => setTask(t))
      .catch((e: Error) => setTaskError(e.message ?? 'Failed to load task'))
      .finally(() => setTaskLoading(false));
  }, [id]);

  // Keep task in sync with WS updates
  useWsEvent((event) => {
    if (event.type !== 'task_updated') return;
    const updated = event.task as Task;
    if (updated.id === id) setTask(updated);
  }, [id]);

  const handleMarkDone = useCallback(async () => {
    if (!api?.updateTask || markingDone) return;
    setMarkingDone(true);
    try {
      const updated = await api.updateTask(id, { status: 'done' });
      setTask(updated);
    } catch (e: unknown) {
      console.error('Failed to mark done:', e);
    } finally {
      setMarkingDone(false);
    }
  }, [id, markingDone]);

  const handleArchive = useCallback(async () => {
    if (!api?.updateTask || archiving) return;
    setArchiving(true);
    try {
      await api.updateTask(id, { archived: true });
      navigate('/');
    } catch (e: unknown) {
      console.error('Failed to archive task:', e);
      setArchiving(false);
    }
  }, [id, archiving]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedSession(null);
  }, []);

  // Reactive desktop detection
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const showSessionList = isDesktop || !selectedSession;
  const showChat = !!selectedSession;

  // Loading state
  if (taskLoading) {
    return (
      <div className="flex flex-col h-dvh">
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px]"
            aria-label="Back to tasks"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-6 w-1/3 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="p-4 space-y-4">
          <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
          <div className="h-20 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  // Error state
  if (taskError || !task) {
    return (
      <div className="flex flex-col h-dvh">
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px]"
            aria-label="Back to tasks"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 text-center">
          <p className="text-destructive">{taskError ?? 'Task not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="text-primary text-sm underline min-h-[44px] px-2"
          >
            Back to tasks
          </button>
        </div>
      </div>
    );
  }

  const isDone = task.status === 'done';

  return (
    <div className="flex flex-col h-dvh">
      {/* Header — shown on mobile when no session selected, always on desktop */}
      {(isDesktop || !selectedSession) && (
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px] shrink-0"
            aria-label="Back to tasks"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
          {DiffViewer && selectedSession && (
            <button
              onClick={() => setDiffOpen(true)}
              className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px] shrink-0"
              aria-label="View changes"
            >
              <Diff className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setInfoOpen(true)}
            className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px] shrink-0"
            aria-label="Task info"
          >
            <Info className="h-4 w-4" />
          </button>
          {HostStatusBadge
            ? <HostStatusBadge status={task.status} />
            : <StatusBadge status={task.status} />}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        {showSessionList && SessionList && (
          <SessionList
            taskId={id}
            selectedSessionId={selectedSession ?? undefined}
            onSelect={handleSelectSession}
          />
        )}

        {/* Fallback if SessionList not available */}
        {showSessionList && !SessionList && (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-muted-foreground text-sm">Session list unavailable</p>
          </div>
        )}

        {/* Chat panel */}
        {showChat && ChatPanel && (
          <ChatPanel
            taskId={id}
            sessionId={selectedSession!}
            onBack={handleBackToList}
            isDone={isDone}
          />
        )}

        {/* Fallback if ChatPanel not available */}
        {showChat && !ChatPanel && (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-muted-foreground text-sm">Chat panel unavailable</p>
          </div>
        )}

        {/* Desktop placeholder when sessions exist but none selected */}
        {isDesktop && !selectedSession && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Select a session</p>
          </div>
        )}
      </div>

      <TaskInfoDrawer
        task={task}
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        onMarkDone={handleMarkDone}
        markingDone={markingDone}
        isDone={isDone}
        onArchive={handleArchive}
        archiving={archiving}
      />

      {diffOpen && DiffViewer && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setDiffOpen(false)}
          />
          <div className="fixed inset-4 z-50 bg-background border rounded-lg shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h2 className="text-sm font-semibold">Changes</h2>
              <button
                onClick={() => setDiffOpen(false)}
                className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DiffViewer sessionId={selectedSession!} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── New Task ─────────────────────────────────────────────────────────────────

function NewTask() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceType, setWorkspaceType] = useState<'git-worktree' | 'cwd'>('git-worktree');
  const [cwdPath, setCwdPath] = useState('');
  const [repos, setRepos] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (workspaceType === 'cwd' && !cwdPath.trim()) {
      setError('Directory path required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const repoUrls = repos.split('\n').map(r => r.trim()).filter(Boolean);
      const body = workspaceType === 'cwd'
        ? {
            title: trimmedTitle,
            description: description.trim() || undefined,
            workspace: { provider: 'cwd', config: { cwd: cwdPath.trim() } },
          }
        : {
            title: trimmedTitle,
            description: description.trim() || undefined,
            repos: repoUrls.length > 0 ? repoUrls : undefined,
            workspace: repoUrls.length > 0
              ? { provider: 'git-worktree', config: { repos: repoUrls } }
              : undefined,
          };

      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `${res.status}`);
      }

      const task: Task = await res.json();
      navigate(`/${task.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center gap-3 z-10">
        <button
          onClick={() => navigate('/')}
          className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center min-h-[44px]"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-base font-semibold">New Task</h1>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-5 pb-8">
        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">Title *</label>
          <input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            required
            maxLength={500}
            className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="text-sm font-medium">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Additional context for the agent…"
            rows={3}
            maxLength={10000}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Workspace</p>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="wt"
                value="git-worktree"
                checked={workspaceType === 'git-worktree'}
                onChange={() => setWorkspaceType('git-worktree')}
                className="h-4 w-4"
              />
              <span className="text-sm">Git worktrees</span>
            </label>
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="wt"
                value="cwd"
                checked={workspaceType === 'cwd'}
                onChange={() => setWorkspaceType('cwd')}
                className="h-4 w-4"
              />
              <span className="text-sm">Local directory</span>
            </label>
          </div>

          {workspaceType === 'git-worktree' && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Repo SSH URLs (one per line, optional)</label>
              <textarea
                value={repos}
                onChange={e => setRepos(e.target.value)}
                placeholder="git@github.com:org/repo.git"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}

          {workspaceType === 'cwd' && (
            <div className="space-y-1.5">
              <label htmlFor="cwd" className="text-xs text-muted-foreground">Directory path</label>
              <input
                id="cwd"
                value={cwdPath}
                onChange={e => setCwdPath(e.target.value)}
                placeholder="/home/user/my-project"
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create Task'}
        </button>
      </form>
    </div>
  );
}

// ─── Root app — internal SPA router ──────────────────────────────────────────

const setHostLayout = (window as any).__AGEMON__?.setHostLayout as ((layout: 'default' | 'fullscreen') => void) | undefined;

export default function TasksApp() {
  const [path, setPath] = useState(getPath);

  useEffect(() => {
    const handler = () => setPath(getPath());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const isTaskDetail = path.length > 1 && /^\/[a-z0-9-]+$/i.test(path);

  // Signal host to hide/show chrome based on current view
  useEffect(() => {
    setHostLayout?.(isTaskDetail ? 'fullscreen' : 'default');
    return () => { setHostLayout?.('default'); };
  }, [isTaskDetail]);

  if (path === '/kanban') return <Kanban />;
  if (path === '/new') return <NewTask />;
  if (isTaskDetail) return <TaskDetail id={path.slice(1)} />;

  return <Dashboard />;
}

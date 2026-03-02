import { useRef, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { RepoSelector } from '@/components/custom/repo-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { taskDetailQuery, taskKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const thoughtsEndRef = useRef<HTMLDivElement>(null);

  const { data: task, isLoading, error } = useQuery(taskDetailQuery(id ?? ''));
  const thoughts = useWsStore((s) => s.thoughts[id ?? ''] ?? []);
  const pendingInputs = useWsStore((s) =>
    s.pendingInputs.filter((p) => p.taskId === id)
  );

  useEffect(() => {
    thoughtsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughts.length]);

  const startMutation = useMutation({
    mutationFn: () => api.startTask(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(id!) });
      showToast({ title: 'Agent started' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to start agent', description: err.message, variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopTask(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(id!) });
      showToast({ title: 'Stop signal sent' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to stop agent', description: err.message, variant: 'destructive' });
    },
  });

  async function handleRepoChange(urls: string[]) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { repos: urls });
      qc.setQueryData(taskKeys.detail(task.id), updated);
    } catch (err) {
      showToast({ title: 'Failed to update repos', description: (err as Error).message, variant: 'destructive' });
    }
  }

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-6 w-1/3 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="p-4 space-y-4">
          <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
          <div className="h-20 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-4 text-center">
          <p className="text-destructive">{error instanceof Error ? error.message : 'Task not found'}</p>
          <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
        </div>
      </div>
    );
  }

  const isRunning = task.status === 'working' || task.status === 'awaiting_input';
  const actionLoading = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <span className="text-sm text-muted-foreground">{task.agent}</span>
        </div>

        {task.description && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1">Description</h2>
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        <RepoSelector
          selected={task.repos.map(r => r.url)}
          onChange={handleRepoChange}
        />

        <div>
          {task.status === 'todo' && (
            <Button className="w-full gap-2" onClick={() => startMutation.mutate()} disabled={actionLoading}>
              <Play className="h-4 w-4" />
              {startMutation.isPending ? 'Starting...' : 'Start Agent'}
            </Button>
          )}
          {isRunning && (
            <Button className="w-full gap-2" variant="destructive" onClick={() => stopMutation.mutate()} disabled={actionLoading}>
              <Square className="h-4 w-4" />
              {stopMutation.isPending ? 'Stopping...' : 'Stop Agent'}
            </Button>
          )}
          {task.status === 'done' && (
            <p className="text-center text-sm text-muted-foreground">Task completed</p>
          )}
        </div>

        {pendingInputs.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Agent needs input</h2>
            {pendingInputs.map((pi) => (
              <div key={pi.inputId} className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium mb-2">{pi.question}</p>
                <p className="text-xs text-muted-foreground">Input handling coming in next update</p>
              </div>
            ))}
          </div>
        )}

        {(isRunning || thoughts.length > 0) && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Agent thoughts {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse ml-1" />}
            </h2>
            <div className="rounded-lg border bg-muted/30 p-3 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
              {thoughts.length === 0 && isRunning && (
                <p className="text-muted-foreground">Waiting for agent output...</p>
              )}
              {thoughts.map((t, i) => (
                <p key={i} className="break-all whitespace-pre-wrap">{t}</p>
              ))}
              <div ref={thoughtsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

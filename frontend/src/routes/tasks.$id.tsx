import { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { RepoSelector } from '@/components/custom/repo-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import type { Task } from '@agemon/shared';

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getTask(id)
      .then(setTask)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRepoChange(urls: string[]) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { repos: urls });
      setTask(updated);
    } catch (err) {
      showToast({ title: 'Failed to update repos', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleStart() {
    if (!task) return;
    setActionLoading(true);
    try {
      await api.startTask(task.id);
      const updated = await api.getTask(task.id);
      setTask(updated);
      showToast({ title: 'Agent started' });
    } catch (err) {
      showToast({ title: 'Failed to start agent', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    if (!task) return;
    setActionLoading(true);
    try {
      await api.stopTask(task.id);
      const updated = await api.getTask(task.id);
      setTask(updated);
      showToast({ title: 'Stop signal sent' });
    } catch (err) {
      showToast({ title: 'Failed to stop agent', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
        <div className="h-20 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{error || 'Task not found'}</p>
        <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
      </div>
    );
  }

  const isRunning = task.status === 'working' || task.status === 'awaiting_input';

  return (
    <div>
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
      </div>

      <div className="p-4 space-y-6">
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
            <Button
              className="w-full gap-2"
              onClick={handleStart}
              disabled={actionLoading}
            >
              <Play className="h-4 w-4" />
              {actionLoading ? 'Starting...' : 'Start Agent'}
            </Button>
          )}
          {isRunning && (
            <Button
              className="w-full gap-2"
              variant="destructive"
              onClick={handleStop}
              disabled={actionLoading}
            >
              <Square className="h-4 w-4" />
              {actionLoading ? 'Stopping...' : 'Stop Agent'}
            </Button>
          )}
          {task.status === 'done' && (
            <p className="text-center text-sm text-muted-foreground">Task completed</p>
          )}
        </div>
      </div>
    </div>
  );
}

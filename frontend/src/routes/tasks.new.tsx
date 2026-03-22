import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RepoSelector } from '@/components/custom/repo-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { friendlyError } from '@/lib/errors';

type WorkspaceType = 'git-worktree' | 'cwd';

export default function TaskCreateForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>('git-worktree');
  const [cwdPath, setCwdPath] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (workspaceType === 'cwd' && !cwdPath.trim()) {
      showToast({ title: 'Directory path required', description: 'Enter the local directory path for this task.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const body =
        workspaceType === 'cwd'
          ? {
              title: trimmedTitle,
              description: description.trim() || undefined,
              workspace: { provider: 'cwd' as const, config: { cwd: cwdPath.trim() } },
            }
          : {
              title: trimmedTitle,
              description: description.trim() || undefined,
              repos: repos.length > 0 ? repos : undefined,
              workspace: repos.length > 0
                ? { provider: 'git-worktree' as const, config: { repos } }
                : undefined,
            };

      const task = await api.createTask(body);
      navigate({ to: '/tasks/$id', params: { id: task.id }, search: { session: undefined } });
    } catch (err) {
      showToast({ title: 'Failed to create task', description: friendlyError(err, 'An unexpected error occurred'), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">New Task</h1>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="h-11"
            maxLength={500}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={e => {
              setDescription(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            placeholder="Additional context for the agent..."
            rows={3}
            maxLength={10000}
            className="resize-none overflow-y-auto max-h-[50vh]"
          />
        </div>

        <div className="space-y-3">
          <Label>Workspace</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="workspaceType"
                value="git-worktree"
                checked={workspaceType === 'git-worktree'}
                onChange={() => setWorkspaceType('git-worktree')}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">Git worktrees</span>
            </label>
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="workspaceType"
                value="cwd"
                checked={workspaceType === 'cwd'}
                onChange={() => setWorkspaceType('cwd')}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">Local directory</span>
            </label>
          </div>

          {workspaceType === 'git-worktree' && (
            <RepoSelector selected={repos} onChange={setRepos} />
          )}

          {workspaceType === 'cwd' && (
            <div className="space-y-2">
              <Label htmlFor="cwdPath">Directory path</Label>
              <Input
                id="cwdPath"
                value={cwdPath}
                onChange={e => setCwdPath(e.target.value)}
                placeholder="/home/user/my-project"
                className="h-11 font-mono text-sm"
              />
            </div>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={!title.trim() || submitting}>
          {submitting ? 'Creating...' : 'Create Task'}
        </Button>
      </form>
    </div>
  );
}

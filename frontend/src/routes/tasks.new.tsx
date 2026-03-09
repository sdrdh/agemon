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

export default function TaskCreateForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      const task = await api.createTask({
        title: trimmedTitle,
        description: description.trim() || undefined,
        repos: repos.length > 0 ? repos : undefined,
      });
      navigate({ to: '/tasks/$id', params: { id: task.id } });
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

        <RepoSelector selected={repos} onChange={setRepos} />

        <Button type="submit" className="w-full" disabled={!title.trim() || submitting}>
          {submitting ? 'Creating...' : 'Create Task'}
        </Button>
      </form>
    </div>
  );
}

import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/components/custom/task-card';
import { tasksByProjectQuery } from '@/lib/query';
import { friendlyError } from '@/lib/errors';

export default function ProjectListView() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery(tasksByProjectQuery());

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-12 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Projects</h1>
          <Button size="icon" aria-label="Create new task" onClick={() => navigate({ to: '/tasks/new' })}>
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="h-10 w-1/3 rounded-md bg-muted animate-pulse" />
          <div className="h-24 rounded-md bg-muted animate-pulse" />
          <div className="h-24 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{friendlyError(error, 'Failed to load tasks')}</p>
        <Button variant="link" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const projectNames = Object.keys(data?.projects ?? {}).sort();
  const hasUngrouped = (data?.ungrouped ?? []).length > 0;

  return (
    <div className="pb-20">
      <div className="sticky top-12 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        <Button size="icon" aria-label="Create new task" onClick={() => navigate({ to: '/tasks/new' })}>
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {projectNames.length === 0 && !hasUngrouped && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tasks yet.</p>
            <Button variant="link" onClick={() => navigate({ to: '/tasks/new' })}>
              Create your first task
            </Button>
          </div>
        )}

        {projectNames.map(name => (
          <section key={name}>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">{name}</h2>
            <div className="space-y-2">
              {(data?.projects[name] ?? []).map(task => (
                <TaskCard
                  key={`${name}-${task.id}`}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        ))}

        {hasUngrouped && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">No repository</h2>
            <div className="space-y-2">
              {(data?.ungrouped ?? []).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

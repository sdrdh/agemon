import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { tasksListQuery } from '@/lib/query';
import { TaskCard } from '@/components/custom/task-card';
import type { Task, TaskStatus } from '@agemon/shared';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'working', label: 'Working' },
  { status: 'awaiting_input', label: 'Awaiting Input' },
  { status: 'done', label: 'Done' },
];

export default function KanbanPage() {
  const navigate = useNavigate();
  const { data: tasks, isLoading, error } = useQuery(tasksListQuery());

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <div key={col.status} className="min-w-[280px] flex-shrink-0 space-y-3">
              <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
              <div className="h-24 rounded-md bg-muted animate-pulse" />
              <div className="h-24 rounded-md bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">
          {error instanceof Error ? error.message : 'Failed to load tasks'}
        </p>
      </div>
    );
  }

  const grouped: Record<TaskStatus, Task[]> = {
    todo: [],
    working: [],
    awaiting_input: [],
    done: [],
  };

  for (const task of tasks ?? []) {
    grouped[task.status].push(task);
  }

  const totalTasks = (tasks ?? []).length;

  return (
    <div className="p-4">
      {totalTasks === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No tasks yet.</p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none">
          {COLUMNS.map((col) => {
            const columnTasks = grouped[col.status];
            return (
              <div
                key={col.status}
                className="min-w-[280px] w-[280px] flex-shrink-0 snap-start md:flex-1 md:w-auto md:min-w-0"
              >
                <div className="flex items-center gap-2 mb-3 px-1">
                  <h2 className="text-sm font-semibold">{col.label}</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {columnTasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() =>
                        navigate({ to: '/tasks/$id', params: { id: task.id } })
                      }
                    />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center text-xs text-muted-foreground">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

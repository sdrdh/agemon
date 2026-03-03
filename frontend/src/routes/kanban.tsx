import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { tasksListQuery } from '@/lib/query';
import { TaskCard } from '@/components/custom/task-card';
import { friendlyError } from '@/lib/errors';
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
  // On mobile, default-open columns that have tasks (computed after data loads)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (status: string) =>
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));

  if (isLoading) {
    return (
      <div className="p-4">
        {/* Mobile skeleton */}
        <div className="space-y-3 lg:hidden">
          {COLUMNS.map((col) => (
            <div key={col.status} className="space-y-2">
              <div className="h-10 rounded-md bg-muted animate-pulse" />
              <div className="h-20 rounded-md bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        {/* Desktop skeleton */}
        <div className="hidden lg:flex gap-4">
          {COLUMNS.map((col) => (
            <div key={col.status} className="flex-1 space-y-3">
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
          {friendlyError(error, 'Failed to load tasks')}
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

  if (totalTasks === 0) {
    return (
      <div className="p-4 text-center py-12 text-muted-foreground">
        <p>No tasks yet.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* ── Mobile: collapsible vertical columns ── */}
      <div className="space-y-2 lg:hidden">
        {COLUMNS.map((col) => {
          const columnTasks = grouped[col.status];
          const isCollapsed = collapsed[col.status] ?? (columnTasks.length === 0);

          return (
            <div key={col.status}>
              <button
                type="button"
                onClick={() => toggle(col.status)}
                className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <h2 className="text-sm font-semibold flex-1 text-left">{col.label}</h2>
                <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
                  {columnTasks.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="space-y-2 pt-2 pl-2">
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

      {/* ── Desktop: horizontal columns ── */}
      <div className="hidden lg:flex gap-4">
        {COLUMNS.map((col) => {
          const columnTasks = grouped[col.status];
          return (
            <div key={col.status} className="flex-1 min-w-0">
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
    </div>
  );
}

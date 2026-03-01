import type { Task } from '@agemon/shared';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from './status-badge';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <Card
      className="cursor-pointer active:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{task.title}</CardTitle>
          <StatusBadge status={task.status} />
        </div>
        <CardDescription className="flex items-center gap-2 mt-1">
          <span>{task.agent}</span>
          {task.repos.length > 1 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {task.repos.length} repos
            </span>
          )}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

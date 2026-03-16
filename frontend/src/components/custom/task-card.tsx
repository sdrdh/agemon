import { memo } from 'react';
import { Shield, Archive, ArchiveRestore } from 'lucide-react';
import type { Task } from '@agemon/shared';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from './status-badge';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  pendingApprovalCount?: number;
  onArchive?: (archived: boolean) => void;
}

export const TaskCard = memo(function TaskCard({ task, onClick, pendingApprovalCount = 0, onArchive }: TaskCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      className={`cursor-pointer active:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${task.archived ? 'opacity-50' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{task.title}</CardTitle>
          <div className="flex items-center gap-1.5">
            {pendingApprovalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-xs font-medium">
                <Shield className="h-3 w-3" />
                {pendingApprovalCount}
              </span>
            )}
            {onArchive && (
              <button
                type="button"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted text-muted-foreground"
                title={task.archived ? 'Unarchive' : 'Archive'}
                onClick={(e) => { e.stopPropagation(); onArchive(!task.archived); }}
              >
                {task.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            )}
            <StatusBadge status={task.status} />
          </div>
        </div>
        {task.repos.length > 1 && (
          <CardDescription className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {task.repos.length} repos
            </span>
          </CardDescription>
        )}
      </CardHeader>
    </Card>
  );
});

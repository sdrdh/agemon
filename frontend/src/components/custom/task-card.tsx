import { Shield, Archive, ArchiveRestore } from 'lucide-react';
import type { Task } from '@agemon/shared';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from './status-badge';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  pendingApprovalCount?: number;
  onArchive?: (archived: boolean) => void;
}

export function TaskCard({ task, onClick, pendingApprovalCount = 0, onArchive }: TaskCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      className={`cursor-pointer active:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${task.archived ? 'opacity-50' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <CardHeader className="p-4">
        <CardTitle className="text-base leading-snug break-words">{task.title}</CardTitle>
        <div className="flex items-center gap-1.5 mt-2">
          <StatusBadge status={task.status} />
          {pendingApprovalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium">
              <Shield className="h-3 w-3" />
              {pendingApprovalCount}
            </span>
          )}
          {task.repos.length > 1 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {task.repos.length} repos
            </span>
          )}
          <div className="flex-1" />
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
        </div>
      </CardHeader>
    </Card>
  );
}

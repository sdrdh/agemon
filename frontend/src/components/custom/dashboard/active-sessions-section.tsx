import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import type { AgentSession, Task } from '@agemon/shared';
import { SessionActivityCard } from './session-activity-card';

interface ActiveSessionsSectionProps {
  sessions: AgentSession[];
  taskMap: Map<string, Task>;
  onNavigateToTask: (taskId: string, sessionId?: string) => void;
}

export const ActiveSessionsSection = memo(function ActiveSessionsSection({
  sessions,
  taskMap,
  onNavigateToTask,
}: ActiveSessionsSectionProps) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No agents running.{' '}
        <Link to="/tasks/new" className="text-primary hover:underline">Start a new task</Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const taskName = taskMap.get(session.task_id)?.title ?? 'Unknown task';
        return (
          <SessionActivityCard
            key={session.id}
            session={session}
            taskName={taskName}
            onNavigate={() => onNavigateToTask(session.task_id, session.id)}
          />
        );
      })}
    </div>
  );
});

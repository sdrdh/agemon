import type { AgentSession, Task } from '@agemon/shared';
import { CompletedSessionCard } from './completed-session-card';

interface RecentlyCompletedSectionProps {
  sessions: AgentSession[];
  taskMap: Map<string, Task>;
  onNavigateToTask: (taskId: string, sessionId?: string) => void;
  onDismiss: (sessionId: string) => void;
}

export function RecentlyCompletedSection({
  sessions,
  taskMap,
  onNavigateToTask,
  onDismiss,
}: RecentlyCompletedSectionProps) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No sessions completed in the last 24h.</p>;
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const taskName = taskMap.get(session.task_id)?.title ?? 'Unknown task';
        return (
          <CompletedSessionCard
            key={session.id}
            session={session}
            taskName={taskName}
            onNavigate={() => onNavigateToTask(session.task_id, session.id)}
            onDismiss={() => onDismiss(session.id)}
          />
        );
      })}
    </div>
  );
}

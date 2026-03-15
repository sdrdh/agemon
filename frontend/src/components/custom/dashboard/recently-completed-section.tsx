import type { AgentSession, Task } from '@agemon/shared';
import { SectionHeader } from './section-header';
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
  if (sessions.length === 0) return null;

  return (
    <div className="space-y-2">
      <SectionHeader title="Recently Completed" colorClass="text-muted-foreground" count={sessions.length} />
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
    </div>
  );
}

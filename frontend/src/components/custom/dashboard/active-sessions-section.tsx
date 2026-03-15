import { Link } from '@tanstack/react-router';
import type { AgentSession, Task, SessionUsage } from '@agemon/shared';
import { SectionHeader } from './section-header';
import { SessionActivityCard } from './session-activity-card';

interface ActiveSessionsSectionProps {
  sessions: AgentSession[];
  taskMap: Map<string, Task>;
  agentActivity: Record<string, string | null>;
  sessionUsage: Record<string, SessionUsage>;
  onNavigateToTask: (taskId: string) => void;
}

export function ActiveSessionsSection({
  sessions,
  taskMap,
  agentActivity,
  sessionUsage,
  onNavigateToTask,
}: ActiveSessionsSectionProps) {
  return (
    <div className="space-y-2">
      <SectionHeader title="Active Sessions" colorClass="text-emerald-500" count={sessions.length} />
      {sessions.length === 0 ? (
        <div className="rounded-lg bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">No agents running</p>
          <Link
            to="/tasks/new"
            className="text-sm text-primary hover:underline"
          >
            Start a new task
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const taskName = taskMap.get(session.task_id)?.title ?? 'Unknown task';
            const activity = agentActivity[session.id] ?? null;
            // Prefer real-time Zustand usage, fallback to REST session.usage
            const usage = sessionUsage[session.id] ?? session.usage;
            return (
              <SessionActivityCard
                key={session.id}
                session={session}
                taskName={taskName}
                activity={activity}
                usage={usage}
                onNavigate={() => onNavigateToTask(session.task_id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

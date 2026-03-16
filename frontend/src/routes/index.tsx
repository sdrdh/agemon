import { useMemo, useCallback, useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sessionsListQuery, tasksListQuery, dashboardActiveQuery, queryClient, dashboardKeys, sessionKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { isSessionActive } from '@/lib/chat-utils';
import { SummaryStrip } from '@/components/custom/dashboard/summary-strip';
import { NeedsInputSection } from '@/components/custom/dashboard/needs-input-section';
import { RecentlyCompletedSection } from '@/components/custom/dashboard/recently-completed-section';
import { IdleSessionCard } from '@/components/custom/dashboard/idle-session-card';
import { SectionHeader } from '@/components/custom/dashboard/section-header';
import type { Task, AgentSession, ApprovalDecision } from '@agemon/shared';

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: sessions, isLoading: sessionsLoading, error: sessionsError } = useQuery(sessionsListQuery());
  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useQuery(tasksListQuery());
  const { data: dashboardActive } = useQuery(dashboardActiveQuery());

  const allApprovals = useWsStore((s) => s.pendingApprovals);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const connected = useWsStore((s) => s.connected);

  // Track dismissed completed sessions (client-side, resets on page reload)
  const [dismissedSessionIds, setDismissedSessionIds] = useState<Set<string>>(new Set());

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks ?? []) map.set(t.id, t);
    return map;
  }, [tasks]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, AgentSession>();
    for (const s of sessions ?? []) map.set(s.id, s);
    return map;
  }, [sessions]);

  // Filter approvals and inputs to only those with active sessions
  const pendingApprovals = useMemo(
    () => allApprovals.filter((a) => {
      if (a.status !== 'pending') return false;
      const session = sessionMap.get(a.sessionId);
      return session && isSessionActive(session.state);
    }),
    [allApprovals, sessionMap],
  );

  const pendingInputs = useMemo(
    () => allPendingInputs.filter((p) => {
      const session = sessionMap.get(p.sessionId);
      return session && isSessionActive(session.state);
    }),
    [allPendingInputs, sessionMap],
  );

  const runningSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.state === 'running'),
    [sessions],
  );

  const recentlyCompleted = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (sessions ?? [])
      .filter(
        (s) =>
          (s.state === 'stopped' || s.state === 'crashed') &&
          s.ended_at &&
          new Date(s.ended_at).getTime() > cutoff &&
          !dismissedSessionIds.has(s.id),
      )
      .sort((a, b) => new Date(b.ended_at!).getTime() - new Date(a.ended_at!).getTime());
  }, [sessions, dismissedSessionIds]);

  const handleApprovalDecision = useCallback((approvalId: string, decision: ApprovalDecision) => {
    sendClientEvent({ type: 'approval_response', approvalId, decision });
  }, []);

  const handleInputSubmit = useCallback((inputId: string, taskId: string, response: string) => {
    sendClientEvent({ type: 'send_input', taskId, inputId, response });
    useWsStore.getState().removePendingInput(inputId);
  }, []);

  const handleNavigateToTask = useCallback((taskId: string, sessionId?: string) => {
    navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: sessionId } });
  }, [navigate]);

  const handleDismissSession = useCallback((sessionId: string) => {
    setDismissedSessionIds((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
  }, []);

  const handleSendToSession = useCallback((sessionId: string, content: string) => {
    sendClientEvent({ type: 'send_message', sessionId, content });
  }, []);

  const handleStopSession = useCallback(async (sessionId: string) => {
    try {
      await api.stopSession(sessionId);
      queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
      queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
    } catch { /* ignore */ }
  }, []);

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      await api.archiveSession(sessionId, true);
      queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
      queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
    } catch { /* ignore */ }
  }, []);

  const activeTaskCount = useMemo(
    () => (tasks ?? []).filter((t) => !t.archived).length,
    [tasks],
  );

  // Idle sessions from REST endpoint — stable reference when undefined
  const idleSessions = useMemo(() => dashboardActive?.idle ?? [], [dashboardActive]);

  const error = sessionsError ?? tasksError;

  if (sessionsLoading || tasksLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-4 gap-2 h-16 bg-muted/30 rounded-lg animate-pulse" />
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{friendlyError(error, 'Failed to load dashboard')}</p>
        <Button variant="link" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const nothingActionable =
    pendingApprovals.length === 0 &&
    pendingInputs.length === 0 &&
    idleSessions.length === 0 &&
    recentlyCompleted.length === 0;

  return (
    <div className="pb-20">
      <SummaryStrip
        blocked={pendingApprovals.length + pendingInputs.length}
        active={runningSessions.length}
        completed={recentlyCompleted.length}
        tasks={activeTaskCount}
      />
      <div className="p-4 space-y-6">
        {activeTaskCount === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tasks yet.</p>
            <Button variant="link" onClick={() => navigate({ to: '/tasks/new' })}>
              Create your first task
            </Button>
          </div>
        ) : nothingActionable ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-base font-medium text-foreground/70">All clear</p>
            <p className="text-sm mt-1">Your agents are working. Nothing needs your attention.</p>
          </div>
        ) : (
          <>
            <NeedsInputSection
              approvals={pendingApprovals}
              inputs={pendingInputs}
              taskMap={taskMap}
              sessionMap={sessionMap}
              connected={connected}
              onApprovalDecision={handleApprovalDecision}
              onInputSubmit={handleInputSubmit}
              onNavigateToTask={handleNavigateToTask}
              onStopSession={handleStopSession}
              onArchiveSession={handleArchiveSession}
            />
            {idleSessions.length > 0 && (
              <div className="space-y-2">
                <SectionHeader title="Idle Sessions" colorClass="text-success" count={idleSessions.length} />
                <div className="space-y-2">
                  {idleSessions.map((entry) => (
                    <IdleSessionCard
                      key={entry.session.id}
                      entry={entry}
                      connected={connected}
                      onSendMessage={handleSendToSession}
                      onStop={handleStopSession}
                      onArchive={handleArchiveSession}
                      onNavigate={() => handleNavigateToTask(entry.task.id, entry.session.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            <RecentlyCompletedSection
              sessions={recentlyCompleted}
              taskMap={taskMap}
              onNavigateToTask={handleNavigateToTask}
              onDismiss={handleDismissSession}
            />
          </>
        )}
      </div>
      {/* FAB */}
      <Link
        to="/tasks/new"
        className="fixed bottom-20 right-4 z-40 h-[52px] w-[52px] rounded-2xl bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}

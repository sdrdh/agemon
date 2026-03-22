/**
 * Prop-driven adapter around SessionListPanel.
 * Owns its own data fetching; no TanStack Router dependency.
 * Used by plugin pages via the PluginKit context.
 */
import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionListPanel } from '@/components/custom/session-list-panel';
import { useWsStore } from '@/lib/store';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { taskSessionsQuery, sessionKeys, taskKeys } from '@/lib/query';
import { isSessionActive } from '@/lib/chat-utils';
import { agentDisplayName } from '@/components/custom/agent-icons';
import type { AgentType } from '@agemon/shared';

export interface SessionListProps {
  taskId: string;
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}

export function SessionList({ taskId, selectedSessionId = undefined, onSelect }: SessionListProps) {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────
  const { data: allSessions = [] } = useQuery(taskSessionsQuery(taskId, true));
  const { data: task } = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => api.getTask(taskId),
    enabled: !!taskId,
  });

  const sessions = useMemo(
    () => (showArchived ? allSessions : allSessions.filter((s) => !s.archived)),
    [allSessions, showArchived],
  );
  const archivedCount = useMemo(
    () => allSessions.filter((s) => s.archived).length,
    [allSessions],
  );

  // ── Session labels ────────────────────────────────────────────────
  const sessionLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    return sessions.map((s) => {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      if (s.name) return s.name;
      const shortName = agentDisplayName(s.agent_type);
      return `${shortName} ${counts[s.agent_type]}`;
    });
  }, [sessions]);

  // ── Derived state ─────────────────────────────────────────────────
  const isDone = task?.status === 'done';
  const hasActiveSessions = sessions.some((s) => isSessionActive(s.state));

  // ── Store ─────────────────────────────────────────────────────────
  const allSessionUsage = useWsStore((s) => s.sessionUsage);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const unreadSessions = useWsStore((s) => s.unreadSessions);
  const clearUnread = useWsStore((s) => s.clearUnread);

  const pendingInputSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allPendingInputs) ids.add(p.sessionId);
    return ids;
  }, [allPendingInputs]);

  // ── Mutations ─────────────────────────────────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: (agentType: AgentType) => api.createSession(taskId, { agentType }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Session created' });
      onSelect(session.id);
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to create session', description: err.message, variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) => api.stopSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Stop signal sent' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to stop session', description: err.message, variant: 'destructive' });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => api.resumeSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Session resumed' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to resume session', description: err.message, variant: 'destructive' });
    },
  });

  const markDoneMutation = useMutation({
    mutationFn: () => api.updateTask(taskId, { status: 'done' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.all });
      showToast({ title: 'Task marked as done' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to mark task done', description: err.message, variant: 'destructive' });
    },
  });

  const archiveSessionMutation = useMutation({
    mutationFn: ({ sessionId, archived }: { sessionId: string; archived: boolean }) =>
      api.archiveSession(sessionId, archived),
    onSuccess: (_, { archived }) => {
      qc.invalidateQueries({ queryKey: sessionKeys.all });
      showToast({ title: archived ? 'Session archived' : 'Session unarchived' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to update session', description: err.message, variant: 'destructive' });
    },
  });

  const actionLoading =
    createSessionMutation.isPending ||
    stopMutation.isPending ||
    resumeMutation.isPending;

  // ── Handlers ──────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (sessionId: string) => {
      clearUnread(sessionId);
      onSelect(sessionId);
    },
    [clearUnread, onSelect],
  );

  return (
    <SessionListPanel
      sessions={sessions}
      activeSessionId={selectedSessionId ?? null}
      onSelect={handleSelect}
      onNew={(agentType) => createSessionMutation.mutate(agentType)}
      onStop={(sid) => stopMutation.mutate(sid)}
      onResume={(sid) => resumeMutation.mutate(sid)}
      onMarkDone={() => markDoneMutation.mutate()}
      onArchiveSession={(sid, archived) => archiveSessionMutation.mutate({ sessionId: sid, archived })}
      showArchived={showArchived}
      onToggleArchived={() => setShowArchived((v) => !v)}
      archivedCount={archivedCount}
      newDisabled={isDone || actionLoading}
      isDone={isDone ?? false}
      hasActiveSessions={hasActiveSessions}
      actionLoading={actionLoading}
      unreadSessions={unreadSessions}
      pendingInputSessionIds={pendingInputSessionIds}
      sessionLabels={sessionLabels}
      sessionUsage={allSessionUsage}
    />
  );
}

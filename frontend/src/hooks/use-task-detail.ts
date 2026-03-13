import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { taskDetailQuery, taskKeys, taskSessionsQuery, sessionKeys } from '@/lib/query';
import { isSessionActive } from '@/lib/chat-utils';
import type { AgentType } from '@agemon/shared';

export function useTaskDetail(taskId: string) {
  const qc = useQueryClient();

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: task, isLoading, error } = useQuery(taskDetailQuery(taskId));
  const { data: sessions = [] } = useQuery(taskSessionsQuery(taskId));

  // ── Mutations ─────────────────────────────────────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: (agentType: AgentType) => api.createSession(taskId, { agentType }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Session created' });
      return session;
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

  const archiveTaskMutation = useMutation({
    mutationFn: (archived: boolean) => api.updateTask(taskId, { archived }),
    onSuccess: (_, archived) => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.all });
      showToast({ title: archived ? 'Task archived' : 'Task unarchived' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to update archive status', description: err.message, variant: 'destructive' });
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

  // ── Derived state ─────────────────────────────────────────────────────
  const isDone = task?.status === 'done';
  const hasSessions = sessions.length > 0;
  const hasActiveSessions = sessions.some(s => isSessionActive(s.state));
  const actionLoading = createSessionMutation.isPending || stopMutation.isPending || resumeMutation.isPending;

  return {
    task,
    sessions,
    isLoading,
    error,
    isDone,
    hasSessions,
    hasActiveSessions,
    actionLoading,
    createSessionMutation,
    stopMutation,
    resumeMutation,
    markDoneMutation,
    archiveTaskMutation,
    archiveSessionMutation,
  };
}

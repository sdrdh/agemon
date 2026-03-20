import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsStore } from '@/lib/store';
import { sessionsListQuery } from '@/lib/query';
import { isSessionActive } from '@/lib/chat-utils';

export function useApprovalCountByTask(): Record<string, number> {
  const pendingApprovals = useWsStore((s) => s.pendingApprovals);
  const { data: sessions } = useQuery(sessionsListQuery());

  return useMemo(() => {
    // Build set of active session IDs for filtering
    const activeSessionIds = new Set<string>();
    for (const s of sessions ?? []) {
      if (isSessionActive(s.state)) activeSessionIds.add(s.id);
    }

    const counts: Record<string, number> = {};
    for (const a of pendingApprovals) {
      if (a.status === 'pending' && activeSessionIds.has(a.sessionId)) {
        counts[a.taskId] = (counts[a.taskId] ?? 0) + 1;
      }
    }
    return counts;
  }, [pendingApprovals, sessions]);
}

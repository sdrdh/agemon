import { useMemo } from 'react';
import { useWsStore } from '@/lib/store';

export function useApprovalCountByTask(): Record<string, number> {
  const pendingApprovals = useWsStore((s) => s.pendingApprovals);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of pendingApprovals) {
      if (a.status === 'pending') counts[a.taskId] = (counts[a.taskId] ?? 0) + 1;
    }
    return counts;
  }, [pendingApprovals]);
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWsStore } from '@/lib/store';
import { agentDisplayName } from '@/components/custom/agent-icons';
import type { AgentSession } from '@agemon/shared';

export function useSessionSelection(
  sessions: AgentSession[],
  isDesktop: boolean,
  taskId: string,
  initialSessionId?: string,
) {
  const navigate = useNavigate();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() =>
    initialSessionId && sessions.some(s => s.id === initialSessionId)
      ? initialSessionId
      : null,
  );
  const clearUnread = useWsStore((s) => s.clearUnread);

  // ── Sync selection from URL — handles async session load AND back navigation ──
  useEffect(() => {
    if (initialSessionId) {
      if (sessions.some(s => s.id === initialSessionId)) {
        setSelectedSessionId(initialSessionId);
      }
    } else {
      // URL has no session param (e.g. back button popped to /tasks/$id without session)
      setSelectedSessionId(null);
    }
  }, [initialSessionId, sessions]);

  // ── Session labels ────────────────────────────────────────────────────
  const sessionLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    return sessions.map((s) => {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      if (s.name) return s.name;
      const shortName = agentDisplayName(s.agent_type);
      return `${shortName} ${counts[s.agent_type]}`;
    });
  }, [sessions]);

  // ── Guard: clear selection if the session was removed ───────────────
  useEffect(() => {
    if (selectedSessionId && !sessions.some(s => s.id === selectedSessionId)) {
      setSelectedSessionId(null);
      navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: undefined }, replace: true });
    }
  }, [sessions, selectedSessionId, navigate, taskId]);

  const activeSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const activeSessionLabel = useMemo(() => {
    const idx = sessions.findIndex(s => s.id === selectedSessionId);
    return idx >= 0 ? sessionLabels[idx] : '';
  }, [sessions, selectedSessionId, sessionLabels]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    clearUnread(sessionId);
    // Desktop: replace so back leaves the task page entirely.
    // Mobile: push so back returns to the session list within the task page.
    navigate({
      to: '/tasks/$id',
      params: { id: taskId },
      search: { session: sessionId },
      replace: isDesktop,
    });
  }, [clearUnread, isDesktop, navigate, taskId]);

  const handleBackToList = useCallback(() => {
    setSelectedSessionId(null);
    navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: undefined }, replace: true });
  }, [navigate, taskId]);

  return {
    selectedSessionId,
    setSelectedSessionId,
    activeSession,
    activeSessionLabel,
    sessionLabels,
    handleSelectSession,
    handleBackToList,
  };
}

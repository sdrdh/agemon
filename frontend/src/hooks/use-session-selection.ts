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

  // ── Async session loading: sessions arrive after mount with URL param ──
  if (initialSessionId && !selectedSessionId && sessions.some(s => s.id === initialSessionId)) {
    setSelectedSessionId(initialSessionId);
  }

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
    navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: sessionId }, replace: true });
    // Push history entry on mobile so back gesture returns to session list
    if (!isDesktop) {
      window.history.pushState({ agemonSession: sessionId }, '');
    }
  }, [clearUnread, isDesktop, navigate, taskId]);

  const handleBackToList = useCallback(() => {
    // Clear selection immediately so UI updates without waiting for popstate
    setSelectedSessionId(null);
    navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: undefined }, replace: true });
    if (!isDesktop) {
      // Also pop the history entry we pushed when selecting the session
      window.history.back();
    }
  }, [isDesktop, navigate, taskId]);

  // Handle browser back gesture / back button on mobile
  useEffect(() => {
    if (isDesktop) return;
    const onPopState = (_e: PopStateEvent) => {
      if (selectedSessionId) {
        // User pressed back while viewing a session — return to session list
        setSelectedSessionId(null);
        navigate({ to: '/tasks/$id', params: { id: taskId }, search: { session: undefined }, replace: true });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isDesktop, selectedSessionId, navigate, taskId]);

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

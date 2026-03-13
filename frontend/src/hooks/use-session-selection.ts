import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWsStore } from '@/lib/store';
import { agentDisplayName } from '@/components/custom/agent-icons';
import type { AgentSession } from '@agemon/shared';

export function useSessionSelection(sessions: AgentSession[], isDesktop: boolean) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const clearUnread = useWsStore((s) => s.clearUnread);

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
    }
  }, [sessions, selectedSessionId]);

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
    // Push history entry on mobile so back gesture returns to session list
    if (!isDesktop) {
      window.history.pushState({ agemonSession: sessionId }, '');
    }
  }, [clearUnread, isDesktop]);

  const handleBackToList = useCallback(() => {
    // Clear selection immediately so UI updates without waiting for popstate
    setSelectedSessionId(null);
    if (!isDesktop) {
      // Also pop the history entry we pushed when selecting the session
      window.history.back();
    }
  }, [isDesktop]);

  // Handle browser back gesture / back button on mobile
  useEffect(() => {
    if (isDesktop) return;
    const onPopState = (_e: PopStateEvent) => {
      if (selectedSessionId) {
        // User pressed back while viewing a session — return to session list
        setSelectedSessionId(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isDesktop, selectedSessionId]);

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

/**
 * Prop-driven adapter around SessionChatPanel.
 * Accepts sessionId (and optionally taskId) and owns all data fetching.
 * No TanStack Router dependency — onBack is received as a prop.
 * Used by plugin pages via the PluginKit context.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SessionChatPanel } from '@/components/custom/session-chat-panel';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useSessionChat } from '@/hooks/use-session-chat';
import { useWsStore } from '@/lib/store';
import { taskSessionsQuery, sessionDetailQuery, sessionKeys } from '@/lib/query';
import { subscribeToSession } from '@/lib/events';
import { api } from '@/lib/api';
import { agentDisplayName } from '@/components/custom/agent-icons';

export interface ChatPanelProps {
  taskId?: string | null;
  sessionId: string;
  /** Called when the back button is tapped on mobile. Optional. */
  onBack?: () => void;
  isDone?: boolean;
  /** Called when the diff button is tapped. Optional — when provided, a diff icon appears in the header. */
  onDiff?: () => void;
  onFiles?: () => void;
}

export function ChatPanel({ taskId = null, sessionId, onBack, isDone = false, onDiff, onFiles }: ChatPanelProps) {
  const isDesktop = useIsDesktop();
  const qc = useQueryClient();
  const [inputText, setInputText] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // ── Subscribe to session-scoped SSE events ────────────────────────
  useEffect(() => {
    subscribeToSession(sessionId);
  }, [sessionId]);

  // ── Resolve the session object ────────────────────────────────────
  // When taskId is provided, resolve from the task's session list (existing behavior).
  // When standalone (no taskId), fetch the single session directly.
  const { data: allSessions = [] } = useQuery({
    ...taskSessionsQuery(taskId ?? '', true),
    enabled: !!taskId,
  });
  const { data: directSession } = useQuery({
    ...sessionDetailQuery(sessionId),
    enabled: !taskId,
  });

  const session = useMemo(
    () => taskId
      ? allSessions.find((s) => s.id === sessionId) ?? null
      : directSession ?? null,
    [taskId, allSessions, directSession, sessionId],
  );

  // ── Session label ──────────────────────────────────────────────────
  const sessionLabel = useMemo(() => {
    if (!session) return '';
    if (session.name) return session.name;
    if (!taskId) return agentDisplayName(session.agent_type);
    // Task-scoped: number sessions by agent type
    const counts: Record<string, number> = {};
    for (const s of allSessions) {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      if (s.id === sessionId) {
        const shortName = agentDisplayName(s.agent_type);
        return `${shortName} ${counts[s.agent_type]}`;
      }
    }
    return agentDisplayName(session.agent_type);
  }, [session, allSessions, sessionId, taskId]);

  // ── Chat data ─────────────────────────────────────────────────────
  const {
    groupedItems,
    agentActivity,
    pendingInputs,
    sessionApprovals,
    turnInFlight,
    hasMore,
    isLoadingMore,
    fetchOlderMessages,
    handleSend,
    handleCancelTurn,
    handleApprovalDecision,
  } = useSessionChat(taskId ?? null, sessionId, session?.state);

  // ── Usage ─────────────────────────────────────────────────────────
  const allSessionUsage = useWsStore((s) => s.sessionUsage);
  const usage = allSessionUsage[sessionId];

  // ── Stop / Resume ─────────────────────────────────────────────────
  const invalidateSession = useCallback(() => {
    if (taskId) {
      qc.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(taskId) });
    } else {
      qc.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    }
  }, [qc, taskId, sessionId]);

  const handleStop = useCallback(async (sid: string) => {
    setActionLoading(true);
    try {
      await api.stopSession(sid);
      invalidateSession();
    } catch (err) {
      console.error('Failed to stop session:', err);
    } finally {
      setActionLoading(false);
    }
  }, [invalidateSession]);

  const handleResume = useCallback(async (sid: string) => {
    setActionLoading(true);
    try {
      await api.resumeSession(sid);
      invalidateSession();
    } catch (err) {
      console.error('Failed to resume session:', err);
    } finally {
      setActionLoading(false);
    }
  }, [invalidateSession]);

  // ── Send wrapper ──────────────────────────────────────────────────
  const handleSendAndClear = (text?: string) => {
    handleSend(text ?? inputText);
    setInputText('');
  };

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading session...</span>
      </div>
    );
  }

  return (
    <SessionChatPanel
      session={session}
      sessionLabel={sessionLabel}
      groupedItems={groupedItems}
      agentActivity={agentActivity}
      pendingInputs={pendingInputs}
      pendingApprovals={sessionApprovals}
      onApprovalDecision={handleApprovalDecision}
      inputText={inputText}
      setInputText={setInputText}
      handleSend={handleSendAndClear}
      onCancelTurn={handleCancelTurn}
      turnInFlight={turnInFlight}
      isDone={isDone}
      actionLoading={actionLoading}
      onStop={handleStop}
      onResume={handleResume}
      onBack={onBack ?? (() => {})}
      isDesktop={isDesktop}
      standalone={!taskId}
      usage={usage}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onFetchOlderMessages={fetchOlderMessages}
      onDiff={onDiff}
      onFiles={onFiles}
    />
  );
}

/**
 * Prop-driven adapter around SessionChatPanel.
 * Accepts taskId + sessionId and owns all data fetching.
 * No TanStack Router dependency — onBack is received as a prop.
 * Used by plugin pages via the PluginKit context.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SessionChatPanel } from '@/components/custom/session-chat-panel';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useSessionChat } from '@/hooks/use-session-chat';
import { useWsStore } from '@/lib/store';
import { taskSessionsQuery } from '@/lib/query';
import { agentDisplayName } from '@/components/custom/agent-icons';

export interface ChatPanelProps {
  taskId: string;
  sessionId: string;
  /** Called when the back button is tapped on mobile. Optional. */
  onBack?: () => void;
  isDone?: boolean;
}

export function ChatPanel({ taskId, sessionId, onBack, isDone = false }: ChatPanelProps) {
  const isDesktop = useIsDesktop();
  const [inputText, setInputText] = useState('');

  // ── Resolve the session object ────────────────────────────────────
  const { data: allSessions = [] } = useQuery(taskSessionsQuery(taskId, true));
  const session = useMemo(
    () => allSessions.find((s) => s.id === sessionId) ?? null,
    [allSessions, sessionId],
  );

  // ── Session label ──────────────────────────────────────────────────
  const sessionLabel = useMemo(() => {
    if (!session) return '';
    if (session.name) return session.name;
    const counts: Record<string, number> = {};
    for (const s of allSessions) {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      if (s.id === sessionId) {
        const shortName = agentDisplayName(s.agent_type);
        return `${shortName} ${counts[s.agent_type]}`;
      }
    }
    return agentDisplayName(session.agent_type);
  }, [session, allSessions, sessionId]);

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
  } = useSessionChat(taskId, sessionId, session?.state);

  // ── Usage ─────────────────────────────────────────────────────────
  const allSessionUsage = useWsStore((s) => s.sessionUsage);
  const usage = allSessionUsage[sessionId];

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
      actionLoading={false}
      onStop={() => {}}
      onResume={() => {}}
      onBack={onBack ?? (() => {})}
      isDesktop={isDesktop}
      usage={usage}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onFetchOlderMessages={fetchOlderMessages}
    />
  );
}

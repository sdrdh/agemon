import { useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsStore, type ToolCall } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { sessionChatQuery } from '@/lib/query';
import { groupMessages, isSessionTerminal } from '@/lib/chat-utils';
import { applyToolCallEvent } from '@/lib/tool-call-helpers';
import type { AgentSessionState, ChatMessage, ApprovalDecision, PendingApproval } from '@agemon/shared';

const EMPTY_MESSAGES: ChatMessage[] = [];

/** Rebuild toolCalls store from persisted chat messages (page reload rehydration). */
function rehydrateToolCalls(
  messages: ChatMessage[],
  sessionId: string,
  upsertToolCall: (sessionId: string, toolCallId: string, patch: Partial<ToolCall>) => void,
): void {
  for (const msg of messages) {
    if (msg.eventType !== 'action') continue;
    try {
      const obj = JSON.parse(msg.content);
      applyToolCallEvent(obj, sessionId, upsertToolCall);
    } catch { /* not JSON */ }
  }
}

export function useSessionChat(taskId: string, selectedSessionId: string | null, sessionState?: AgentSessionState) {
  // ── Per-session chat history from server ──────────────────────────────
  const { data: sessionChatHistory } = useQuery(
    sessionChatQuery(selectedSessionId ?? '', 500),
  );

  // ── Store selectors (keyed by sessionId) ──────────────────────────────
  const chatMessages = useWsStore((s) =>
    selectedSessionId ? (s.chatMessages[selectedSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const setChatMessages = useWsStore((s) => s.setChatMessages);
  const appendChatMessage = useWsStore((s) => s.appendChatMessage);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const removePendingInput = useWsStore((s) => s.removePendingInput);
  const agentActivity = useWsStore((s) =>
    selectedSessionId ? (s.agentActivity[selectedSessionId] ?? null) : null
  );
  const unreadSessions = useWsStore((s) => s.unreadSessions);
  const clearUnread = useWsStore((s) => s.clearUnread);
  const turnInFlight = useWsStore((s) =>
    selectedSessionId ? (s.turnsInFlight[selectedSessionId] ?? false) : false
  );
  const setTurnInFlight = useWsStore((s) => s.setTurnInFlight);

  // ── Approvals ─────────────────────────────────────────────────────────
  const allPendingApprovals = useWsStore((s) => s.pendingApprovals);
  const mergePendingApprovals = useWsStore((s) => s.mergePendingApprovals);

  // Fetch and merge pending approvals on mount
  useEffect(() => {
    if (!taskId) return;
    fetch(`/api/tasks/${taskId}/approvals?all=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('agemon_key') ?? ''}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((approvals: PendingApproval[]) => {
        mergePendingApprovals(taskId, approvals);
      })
      .catch(() => { /* ignore */ });
  }, [taskId, mergePendingApprovals]);

  const pendingInputs = useMemo(
    () => selectedSessionId
      ? allPendingInputs.filter((p) => p.sessionId === selectedSessionId)
      : [],
    [allPendingInputs, selectedSessionId],
  );

  const sessionApprovals = useMemo(
    () => selectedSessionId
      ? allPendingApprovals.filter((a) => a.sessionId === selectedSessionId)
      : [],
    [allPendingApprovals, selectedSessionId],
  );

  const pendingInputSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allPendingInputs) ids.add(p.sessionId);
    return ids;
  }, [allPendingInputs]);

  // ── Clear unread for the active session ─────────────────────────────
  useEffect(() => {
    if (selectedSessionId) clearUnread(selectedSessionId);
  }, [selectedSessionId, chatMessages, clearUnread]);

  // ── Seed store from server chat history ───────────────────────────────
  const upsertToolCall = useWsStore((s) => s.upsertToolCall);

  useEffect(() => {
    if (selectedSessionId && sessionChatHistory && sessionChatHistory.length > 0) {
      setChatMessages(selectedSessionId, sessionChatHistory);
      // Rehydrate tool calls from persisted chat messages
      rehydrateToolCalls(sessionChatHistory, selectedSessionId, upsertToolCall);
    }
  }, [sessionChatHistory, selectedSessionId, setChatMessages, upsertToolCall]);

  // ── Clear turn-in-flight when session terminates ────────────────────
  useEffect(() => {
    if (selectedSessionId && sessionState && isSessionTerminal(sessionState)) {
      setTurnInFlight(selectedSessionId, false);
    }
  }, [selectedSessionId, sessionState, setTurnInFlight]);

  // ── Grouped items ─────────────────────────────────────────────────────
  const groupedItems = useMemo(() => groupMessages(chatMessages, selectedSessionId ?? undefined), [chatMessages, selectedSessionId]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSend = useCallback((inputText: string) => {
    const text = inputText.trim();
    if (!text || !selectedSessionId) return;

    if (pendingInputs.length > 0) {
      const pi = pendingInputs[0];
      sendClientEvent({ type: 'send_input', taskId, inputId: pi.inputId, response: text });
      removePendingInput(pi.inputId);
    } else {
      sendClientEvent({ type: 'send_message', sessionId: selectedSessionId, content: text });
    }

    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      eventType: pendingInputs.length > 0 ? 'input_response' : 'prompt',
      timestamp: new Date().toISOString(),
    };
    appendChatMessage(selectedSessionId, optimisticMsg);
    setTurnInFlight(selectedSessionId, true);
  }, [pendingInputs, taskId, selectedSessionId, removePendingInput, appendChatMessage, setTurnInFlight]);

  const handleCancelTurn = useCallback(() => {
    if (!selectedSessionId || !turnInFlight) return;
    sendClientEvent({ type: 'cancel_turn', sessionId: selectedSessionId });
  }, [selectedSessionId, turnInFlight]);

  const handleApprovalDecision = useCallback((approvalId: string, decision: ApprovalDecision) => {
    sendClientEvent({ type: 'approval_response', approvalId, decision });
  }, []);

  return {
    chatMessages,
    groupedItems,
    agentActivity,
    pendingInputs,
    sessionApprovals,
    unreadSessions,
    turnInFlight,
    pendingInputSessionIds,
    handleSend,
    handleCancelTurn,
    handleApprovalDecision,
  };
}

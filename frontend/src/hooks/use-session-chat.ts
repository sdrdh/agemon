import { useEffect, useMemo, useCallback, useState, useRef, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsStore, type ToolCall } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { sessionChatQuery } from '@/lib/query';
import { api } from '@/lib/api';
import { groupMessages, isSessionTerminal } from '@/lib/chat-utils';
import { applyToolCallEvent } from '@/lib/tool-call-helpers';
import type { AgentSessionState, ChatMessage, ApprovalDecision } from '@agemon/shared';

const EMPTY_MESSAGES: ChatMessage[] = [];

/** Rebuild toolCalls store from persisted chat messages (page reload rehydration). */
function rehydrateToolCalls(
  messages: ChatMessage[],
  sessionId: string,
  upsertToolCall: (sessionId: string, toolCallId: string, patch: Partial<ToolCall>) => void,
  seenIdsRef?: MutableRefObject<Set<string>>,
): void {
  for (const msg of messages) {
    if (msg.eventType !== 'action') continue;
    if (seenIdsRef && seenIdsRef.current.has(msg.id)) continue;
    seenIdsRef?.current.add(msg.id);
    try {
      const obj = JSON.parse(msg.content);
      applyToolCallEvent(obj, sessionId, upsertToolCall);
    } catch { /* not JSON */ }
  }
}

export function useSessionChat(taskId: string | null, selectedSessionId: string | null, sessionState?: AgentSessionState) {
  // ── Per-session chat history from server ──────────────────────────────
  const { data: sessionChatData } = useQuery(
    sessionChatQuery(selectedSessionId ?? '', 50),
  );

  // ── Pagination state ──────────────────────────────────────────────────
  // hasMore/isLoadingMore use refs for gating in callbacks (rerender-use-ref-transient-values)
  // and state for UI rendering of the spinner
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const rehydratedIdsRef = useRef(new Set<string>());

  // Update hasMore from initial fetch
  // Guard: sessionChatData.messages may be undefined if React Query serves a stale cache
  // from before the response shape changed from ChatMessage[] to { messages, hasMore }
  useEffect(() => {
    if (sessionChatData?.messages) {
      setHasMore(sessionChatData.hasMore);
      hasMoreRef.current = sessionChatData.hasMore;
    }
  }, [sessionChatData]);

  // Reset pagination + rehydration state on session change
  useEffect(() => {
    setHasMore(false);
    setIsLoadingMore(false);
    hasMoreRef.current = false;
    isLoadingMoreRef.current = false;
    rehydratedIdsRef.current = new Set();
  }, [selectedSessionId]);

  // ── Store selectors (keyed by sessionId) ──────────────────────────────
  const chatMessages = useWsStore((s) =>
    selectedSessionId ? (s.chatMessages[selectedSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const setChatMessages = useWsStore((s) => s.setChatMessages);
  const appendChatMessage = useWsStore((s) => s.appendChatMessage);
  const prependChatMessages = useWsStore((s) => s.prependChatMessages);
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
    if (taskId) {
      api.listApprovals(taskId)
        .then((approvals) => mergePendingApprovals(taskId, approvals))
        .catch(() => { /* ignore */ });
    } else if (selectedSessionId) {
      api.listSessionApprovals(selectedSessionId)
        .then((approvals) => mergePendingApprovals(selectedSessionId, approvals))
        .catch(() => { /* ignore */ });
    }
  }, [taskId, selectedSessionId, mergePendingApprovals]);

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
  // Track which session we've already seeded — first fetch seeds, refetches (window focus) don't
  const seededSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedSessionId && sessionChatData?.messages && sessionChatData.messages.length > 0) {
      if (seededSessionRef.current !== selectedSessionId) {
        // First fetch for this session: always seed (even if WS already delivered some messages)
        setChatMessages(selectedSessionId, sessionChatData.messages);
        seededSessionRef.current = selectedSessionId;
      }
      // Rehydrate tool calls from persisted chat messages
      rehydrateToolCalls(sessionChatData.messages, selectedSessionId, upsertToolCall, rehydratedIdsRef);
    }
  }, [sessionChatData, selectedSessionId, setChatMessages, upsertToolCall]);

  // ── Clear turn-in-flight when session terminates ────────────────────
  useEffect(() => {
    if (selectedSessionId && sessionState && isSessionTerminal(sessionState)) {
      setTurnInFlight(selectedSessionId, false);
    }
  }, [selectedSessionId, sessionState, setTurnInFlight]);

  // ── Fetch older messages (scroll-up pagination) ─────────────────────
  // Uses refs for gating to avoid recreating callback on transient state changes (rerender-functional-setstate)
  const fetchOlderMessages = useCallback(async () => {
    if (!selectedSessionId || !hasMoreRef.current || isLoadingMoreRef.current) return;
    const currentMessages = useWsStore.getState().chatMessages[selectedSessionId];
    if (!currentMessages || currentMessages.length === 0) return;

    const earliest = currentMessages[0].timestamp;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const response = await api.getSessionChat(selectedSessionId, 50, earliest);
      prependChatMessages(selectedSessionId, response.messages);
      setHasMore(response.hasMore);
      hasMoreRef.current = response.hasMore;
      // Rehydrate tool calls from older messages
      rehydrateToolCalls(response.messages, selectedSessionId, upsertToolCall, rehydratedIdsRef);
    } catch {
      /* ignore fetch errors */
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [selectedSessionId, prependChatMessages, upsertToolCall]);

  // ── Grouped items ─────────────────────────────────────────────────────
  const groupedItems = useMemo(() => groupMessages(chatMessages), [chatMessages]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSend = useCallback((inputText: string) => {
    const text = inputText.trim();
    if (!text || !selectedSessionId) return;

    // Capture before mutation so optimistic message has the correct eventType
    const pendingInput = pendingInputs.length > 0 ? pendingInputs[0] : null;
    if (pendingInput) {
      sendClientEvent({ type: 'send_input', sessionId: selectedSessionId, inputId: pendingInput.inputId, response: text });
      removePendingInput(pendingInput.inputId);
    } else {
      sendClientEvent({ type: 'send_message', sessionId: selectedSessionId, content: text });
    }

    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      eventType: pendingInput ? 'input_response' : 'prompt',
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
    hasMore,
    isLoadingMore,
    fetchOlderMessages,
    handleSend,
    handleCancelTurn,
    handleApprovalDecision,
  };
}

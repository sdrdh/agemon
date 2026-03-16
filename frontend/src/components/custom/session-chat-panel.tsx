import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { SessionMobileHeader } from '@/components/custom/session-mobile-header';
import { ChatMessagesArea } from '@/components/custom/chat-messages-area';
import { ChatInputArea } from '@/components/custom/chat-input-area';
import { SessionModeBar } from '@/components/custom/session-mode-bar';
import { isSessionActive, isSessionTerminal } from '@/lib/chat-utils';
import { useWsStore } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { api } from '@/lib/api';
import type { ChatItem } from '@/lib/chat-utils';
import type { AgentCommand, AgentSession, PendingApproval, ApprovalDecision, SessionUsage } from '@agemon/shared';

const NEAR_BOTTOM_THRESHOLD = 150;

export function SessionChatPanel({
  session,
  sessionLabel,
  groupedItems,
  agentActivity,
  pendingInputs,
  pendingApprovals,
  onApprovalDecision,
  inputText,
  setInputText,
  handleSend,
  onCancelTurn,
  turnInFlight,
  isDone,
  actionLoading,
  onStop,
  onResume,
  onBack,
  isDesktop,
  chatEndRef,
  usage,
  hasMore,
  isLoadingMore,
  onFetchOlderMessages,
}: {
  session: AgentSession;
  sessionLabel: string;
  groupedItems: ChatItem[];
  agentActivity: string | null;
  pendingInputs: { inputId: string; question: string }[];
  pendingApprovals: PendingApproval[];
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  inputText: string;
  setInputText: (text: string) => void;
  handleSend: () => void;
  onCancelTurn: () => void;
  turnInFlight: boolean;
  isDone: boolean;
  actionLoading: boolean;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onBack: () => void;
  isDesktop: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
  usage?: SessionUsage;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onFetchOlderMessages?: () => Promise<void>;
}) {
  const sessionRunning = isSessionActive(session.state);
  const sessionStopped = isSessionTerminal(session.state);
  const sessionReady = session.state === 'ready';
  const canType = sessionRunning && !turnInFlight && !isDone;
  const connected = useWsStore((s) => s.connected);

  // ── Config options ──────────────────────────────────────────────────────
  const configOptions = useWsStore((s) => s.configOptions[session.id]);
  const setConfigOptions = useWsStore((s) => s.setConfigOptions);
  const modelOption = configOptions?.find(o => o.id === 'model' && o.type === 'select' && o.options.length > 0) ?? null;
  const modeOption = configOptions?.find(o => o.id === 'mode' && o.type === 'select' && o.options.length > 0) ?? null;
  const currentMode = modeOption?.value ?? 'default';

  // Fetch config options on mount if not already in store (page refresh case)
  useEffect(() => {
    if (!configOptions && sessionRunning) {
      api.getSessionConfig(session.id).then((opts) => {
        if (opts && opts.length > 0) setConfigOptions(session.id, opts);
      }).catch(() => {});
    }
  }, [session.id, sessionRunning, configOptions, setConfigOptions]);

  const handleConfigChange = useCallback((configId: string, value: string) => {
    sendClientEvent({ type: 'set_config_option', sessionId: session.id, configId, value });
    // Optimistically update store
    if (configOptions) {
      const updated = configOptions.map(o => o.id === configId ? { ...o, value } : o);
      setConfigOptions(session.id, updated);
    }
  }, [session.id, configOptions, setConfigOptions]);

  const cycleMode = useCallback(() => {
    if (!modeOption) return;
    const idx = modeOption.options.findIndex(o => o.value === modeOption.value);
    const next = modeOption.options[(idx + 1) % modeOption.options.length];
    handleConfigChange('mode', next.value);
  }, [modeOption, handleConfigChange]);

  // ── Slash command autocomplete ─────────────────────────────────────────
  const availableCommands = useWsStore((s) => s.availableCommands[session.id]) ?? [];
  const setAvailableCommands = useWsStore((s) => s.setAvailableCommands);

  // Fetch available commands on mount if not already in store (page refresh case)
  useEffect(() => {
    if (availableCommands.length === 0 && sessionRunning) {
      api.getSessionCommands(session.id).then((cmds) => {
        if (cmds && cmds.length > 0) setAvailableCommands(session.id, cmds);
      }).catch(() => {});
    }
  }, [session.id, sessionRunning, availableCommands.length, setAvailableCommands]);

  const [selectedCommandIdx, setSelectedCommandIdx] = useState(-1);
  const hasNavigatedRef = useRef(false);

  // Auto-resize textarea height on input
  const adjustTextareaHeight = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const filteredCommands = useMemo(() => {
    if (!inputText.startsWith('/') || availableCommands.length === 0) return [];
    const query = inputText.slice(1).toLowerCase();
    // Show all commands when just "/" is typed, otherwise filter by prefix
    return availableCommands.filter(
      (cmd) => !query || cmd.name.toLowerCase().startsWith(query)
    );
  }, [inputText, availableCommands]);

  const showCommandMenu = filteredCommands.length > 0;

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedCommandIdx(showCommandMenu ? 0 : -1);
    hasNavigatedRef.current = false;
  }, [filteredCommands, showCommandMenu]);

  const selectCommand = useCallback((cmd: AgentCommand) => {
    setInputText(`/${cmd.name} `);
    hasNavigatedRef.current = false;
  }, [setInputText]);

  // ── Sticky scroll ─────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);

  // Refs to avoid recreating handleScroll on every prop change (rerender-use-ref-transient-values)
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const fetchRef = useRef(onFetchOlderMessages);
  hasMoreRef.current = hasMore;
  isLoadingMoreRef.current = isLoadingMore;
  fetchRef.current = onFetchOlderMessages;

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessages(false);

    // Scroll-to-top: load older messages
    if (el.scrollTop < 100 && hasMoreRef.current && !isLoadingMoreRef.current && fetchRef.current) {
      const prevScrollHeight = el.scrollHeight;
      fetchRef.current().then(() => {
        // Wait for React to commit the prepended messages before restoring scroll
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevScrollHeight;
        });
      });
    }
  }, []);

  // Auto-scroll only when near bottom.
  // Uses 'instant' to avoid smooth-scroll animations racing with rapid streaming
  // (each smooth scroll targets a position that becomes stale as new content arrives).
  // We also track the previous groupedItems length to distinguish new content
  // (should auto-scroll) from regrouping (should not).
  const prevGroupedLenRef = useRef(groupedItems.length);
  useEffect(() => {
    const prevLen = prevGroupedLenRef.current;
    prevGroupedLenRef.current = groupedItems.length;

    // Skip if length decreased (regrouping collapse) — don't jump scroll
    if (groupedItems.length < prevLen) return;

    // Compute nearBottom fresh — the ref can be stale when content is added
    // without a user scroll event (scrollHeight grows, scrollTop stays the same).
    const el = scrollContainerRef.current;
    const nearBottom = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
      : isNearBottomRef.current;

    if (nearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: 'instant' });
    } else if (groupedItems.length > prevLen) {
      setShowNewMessages(true);
    }
  }, [groupedItems.length, agentActivity, chatEndRef]);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMessages(false);
  }, [chatEndRef]);

  const approvalLookup = useMemo(() => {
    const map = new Map<string, PendingApproval>();
    for (const a of pendingApprovals) map.set(a.id, a);
    return map;
  }, [pendingApprovals]);

  const inputPlaceholder = useMemo(() => {
    if (isDone) return 'Task completed';
    if (sessionStopped) return 'Session ended';
    if (sessionReady) return 'Send your first message...';
    if (turnInFlight) return 'Agent is working...';
    if (pendingInputs.length > 0) return pendingInputs[0].question;
    return 'Send a message...';
  }, [isDone, sessionStopped, sessionReady, turnInFlight, pendingInputs]);

  const totalUsed = usage ? usage.inputTokens + usage.outputTokens + usage.cachedReadTokens + usage.cachedWriteTokens : 0;
  const contextPct = usage ? Math.min(100, Math.round((totalUsed / usage.contextWindow) * 100)) : null;
  const contextBarColor = contextPct !== null
    ? contextPct >= 70 ? 'bg-red-500' : contextPct >= 50 ? 'bg-amber-400' : 'bg-emerald-500'
    : 'bg-emerald-500';

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {!isDesktop && (
        <SessionMobileHeader
          sessionLabel={sessionLabel}
          sessionState={session.state}
          sessionRunning={sessionRunning}
          actionLoading={actionLoading}
          onBack={onBack}
          onStop={() => onStop(session.id)}
        />
      )}

      <ChatMessagesArea
        sessionReady={sessionReady}
        sessionRunning={sessionRunning}
        sessionState={session.state}
        selectedSessionId={session.id}
        groupedItems={groupedItems}
        agentActivity={agentActivity}
        showNewMessages={showNewMessages}
        scrollContainerRef={scrollContainerRef}
        chatEndRef={chatEndRef}
        approvalLookup={approvalLookup}
        onScroll={handleScroll}
        onApprovalDecision={onApprovalDecision}
        scrollToBottom={scrollToBottom}
        connected={connected}
        isLoadingMore={isLoadingMore}
      />

      <div className="border-t bg-background">
        {contextPct !== null && (
          <div className="flex items-center gap-2 px-4 pt-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${contextBarColor}`} style={{ width: `${contextPct}%` }} />
            </div>
            <span className={`text-[11px] tabular-nums shrink-0 ${contextPct >= 70 ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
              {contextPct}% ctx
            </span>
          </div>
        )}
        <div className="px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ChatInputArea
            connected={connected}
            sessionStopped={sessionStopped}
            sessionReady={sessionReady}
            canType={canType}
            isDone={isDone}
            turnInFlight={turnInFlight}
            inputText={inputText}
            inputPlaceholder={inputPlaceholder}
            currentMode={currentMode}
            actionLoading={actionLoading}
            filteredCommands={filteredCommands}
            selectedCommandIdx={selectedCommandIdx}
            hasNavigatedRef={hasNavigatedRef}
            onSetInputText={setInputText}
            onSend={handleSend}
            onCancelTurn={onCancelTurn}
            onResume={() => onResume(session.id)}
            onSelectCommand={selectCommand}
            onSetSelectedCommandIdx={setSelectedCommandIdx}
            onAdjustTextareaHeight={adjustTextareaHeight}
          />
          <SessionModeBar
            modeOption={modeOption}
            modelOption={modelOption}
            currentMode={currentMode}
            sessionRunning={sessionRunning}
            onCycleMode={cycleMode}
            onConfigChange={handleConfigChange}
          />
        </div>
      </div>
    </div>
  );
}

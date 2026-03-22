import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { SessionMobileHeader } from '@/components/custom/session-mobile-header';
import { ChatMessagesArea } from '@/components/custom/chat-messages-area';
import { ChatInputArea } from '@/components/custom/chat-input-area';
import { SessionModeBar } from '@/components/custom/session-mode-bar';
import { isSessionActive, isSessionTerminal } from '@/lib/chat-utils';
import { useWsStore } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { api } from '@/lib/api';
import { useInputExtensions } from '@/lib/use-input-extensions';
import type { ChatItem } from '@/lib/chat-utils';
import type { AgentCommand, AgentSession, PendingApproval, ApprovalDecision, SessionUsage } from '@agemon/shared';

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
  handleSend: (text?: string) => void;
  onCancelTurn: () => void;
  turnInFlight: boolean;
  isDone: boolean;
  actionLoading: boolean;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onBack: () => void;
  isDesktop: boolean;
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

  // ── Input extensions ─────────────────────────────────────────────────
  const { extensions, loadExtension } = useInputExtensions();
  const [activeExtensionId, setActiveExtensionId] = useState<string | null>(null);

  const handleActivateExtension = useCallback((pluginId: string, extId: string) => {
    loadExtension(pluginId, extId);
    setActiveExtensionId(`${pluginId}:${extId}`);
  }, [loadExtension]);

  const handleDeactivateExtension = useCallback(() => {
    setActiveExtensionId(null);
  }, []);

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

  // Reset selection when the command list appears/disappears or its length changes
  useEffect(() => {
    setSelectedCommandIdx(showCommandMenu ? 0 : -1);
    hasNavigatedRef.current = false;
  }, [filteredCommands.length, showCommandMenu]);

  const selectCommand = useCallback((cmd: AgentCommand) => {
    setInputText(`/${cmd.name} `);
    hasNavigatedRef.current = false;
  }, [setInputText]);

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
    ? contextPct >= 70 ? 'bg-destructive' : contextPct >= 50 ? 'bg-warning' : 'bg-success'
    : 'bg-success';

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
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
        approvalLookup={approvalLookup}
        onApprovalDecision={onApprovalDecision}
        connected={connected}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onFetchOlderMessages={onFetchOlderMessages}
      />

      <div className="border-t bg-background shrink-0">
        {contextPct !== null && (
          <div className="flex items-center gap-2 px-4 pt-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${contextBarColor}`} style={{ width: `${contextPct}%` }} />
            </div>
            <span className={`text-[11px] tabular-nums shrink-0 ${contextPct >= 70 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
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
            extensions={extensions}
            activeExtensionId={activeExtensionId}
            sessionState={session.state}
            onSetInputText={setInputText}
            onSend={handleSend}
            onCancelTurn={onCancelTurn}
            onResume={() => onResume(session.id)}
            onSelectCommand={selectCommand}
            onSetSelectedCommandIdx={setSelectedCommandIdx}
            onAdjustTextareaHeight={adjustTextareaHeight}
            onActivateExtension={handleActivateExtension}
            onDeactivateExtension={handleDeactivateExtension}
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

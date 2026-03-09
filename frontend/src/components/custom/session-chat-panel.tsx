import { useMemo, useRef, useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { ArrowLeft, Send, Ban, RotateCcw, ChevronsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActivityGroup } from '@/components/custom/activity-group';
import { ChatBubble } from '@/components/custom/chat-bubble';
import { ConfigOptionPicker } from '@/components/custom/config-option-picker';
import { SESSION_STATE_DOT, isSessionActive, isSessionTerminal } from '@/lib/chat-utils';
import { useWsStore } from '@/lib/store';
import { sendClientEvent } from '@/lib/ws';
import { api } from '@/lib/api';
import type { ChatItem } from '@/lib/chat-utils';
import type { AgentCommand, AgentSession, PendingApproval, ApprovalDecision } from '@agemon/shared';

const NEAR_BOTTOM_THRESHOLD = 150;

/** Input border/bg color per mode */
const MODE_INPUT_STYLES: Record<string, string> = {
  default: '',
  plan: 'border-amber-400/60 bg-amber-50/30 dark:bg-amber-950/20',
  acceptEdits: 'border-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20',
  dontAsk: 'border-orange-400/60 bg-orange-50/30 dark:bg-orange-950/20',
  bypassPermissions: 'border-red-400/60 bg-red-50/30 dark:bg-red-950/20',
};

/** Badge color per mode */
const MODE_BADGE_STYLES: Record<string, string> = {
  default: 'bg-muted text-muted-foreground hover:bg-muted/80',
  plan: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
  acceptEdits: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60',
  dontAsk: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/60',
  bypassPermissions: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60',
};

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
}) {
  const sessionRunning = isSessionActive(session.state);
  const sessionStopped = isSessionTerminal(session.state);
  const sessionReady = session.state === 'ready';
  const canType = sessionRunning && !turnInFlight && !isDone;

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
  const [selectedCommandIdx, setSelectedCommandIdx] = useState(-1);
  const hasNavigatedRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height on input
  const adjustTextareaHeight = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Reset height when input is cleared (after send)
  useEffect(() => {
    if (!inputText && inputRef.current) {
      inputRef.current.style.height = '';
    }
  }, [inputText]);

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
    inputRef.current?.focus();
  }, [setInputText]);

  const handleInputKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        hasNavigatedRef.current = true;
        setSelectedCommandIdx((prev) =>
          prev <= 0 ? filteredCommands.length - 1 : prev - 1
        );
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        hasNavigatedRef.current = true;
        setSelectedCommandIdx((prev) =>
          prev >= filteredCommands.length - 1 ? 0 : prev + 1
        );
        return;
      } else if (e.key === 'Tab' || (e.key === 'Enter' && hasNavigatedRef.current && selectedCommandIdx >= 0)) {
        e.preventDefault();
        const cmd = filteredCommands[selectedCommandIdx];
        if (cmd) selectCommand(cmd);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInputText('');
        return;
      }
    }

    // Enter sends; Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((canType || sessionReady) && inputText.trim()) {
        handleSend();
      }
    }
  }, [showCommandMenu, filteredCommands, selectedCommandIdx, selectCommand, setInputText, canType, sessionReady, inputText, handleSend]);

  // ── Sticky scroll ─────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessages(false);
  }, []);

  // Auto-scroll only when near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
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

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {!isDesktop && (
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button size="icon" variant="ghost" aria-label="Back to sessions" onClick={onBack} className="min-h-[44px] min-w-[44px]">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${SESSION_STATE_DOT[session.state]} shrink-0`} />
          <span className="text-sm font-medium flex-1 truncate">{sessionLabel}</span>
          {sessionRunning && (
            <Button
              size="sm"
              variant="outline"
              aria-label="Stop session"
              onClick={() => onStop(session.id)}
              disabled={actionLoading}
              className="gap-1.5"
            >
              <Ban className="h-3.5 w-3.5 text-red-500" />
              Stop
            </Button>
          )}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3"
        >
          {groupedItems.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground text-sm">
                {sessionReady
                  ? 'Session ready. Send your first message.'
                  : isSessionActive(session.state)
                    ? 'Waiting for agent output...'
                    : 'No messages in this session.'}
              </p>
            </div>
          )}

          {groupedItems.map((item, idx) => {
            if (item.kind === 'activity-group') {
              return <ActivityGroup key={`ag-${item.messages[0].id}`} messages={item.messages} isLast={idx === groupedItems.length - 1} />;
            }
            return (
              <ChatBubble
                key={item.message.id}
                message={item.message}
                approvalLookup={approvalLookup}
                onApprovalDecision={onApprovalDecision}
              />
            );
          })}

          {agentActivity && sessionRunning && !agentActivity.startsWith('Waiting for approval') && (
            <div className="flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
              </span>
              <span className="truncate">{agentActivity}</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* New messages pill */}
        {showNewMessages && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors min-h-[32px]"
          >
            <ChevronsDown className="h-3.5 w-3.5" />
            New messages
          </button>
        )}
      </div>

      <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background">
        {sessionStopped && !isDone ? (
          <Button
            className="w-full gap-2 min-h-[44px]"
            onClick={() => onResume(session.id)}
            disabled={actionLoading}
          >
            <RotateCcw className="h-4 w-4" />
            {actionLoading ? 'Resuming...' : 'Resume Session'}
          </Button>
        ) : (
          <>
            <div className="relative">
              {showCommandMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border bg-popover text-popover-foreground shadow-md max-h-[240px] overflow-y-auto z-50">
                  {filteredCommands.map((cmd, idx) => (
                    <button
                      key={cmd.name}
                      type="button"
                      className={`w-full text-left px-3 py-2.5 min-h-[44px] flex flex-col gap-0.5 transition-colors ${
                        idx === selectedCommandIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent input blur
                        selectCommand(cmd);
                      }}
                      onMouseEnter={() => setSelectedCommandIdx(idx)}
                    >
                      <span className="text-sm font-medium">/{cmd.name}</span>
                      {cmd.description && (
                        <span className="text-xs text-muted-foreground truncate">{cmd.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    adjustTextareaHeight(e.target);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder={inputPlaceholder}
                  disabled={!canType && !sessionReady}
                  rows={1}
                  className={`flex-1 min-h-[44px] max-h-[40vh] resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${MODE_INPUT_STYLES[currentMode] ?? ''}`}
                />
                {turnInFlight ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    onClick={onCancelTurn}
                    className="min-h-[44px] min-w-[44px]"
                    aria-label="Cancel turn"
                  >
                    <Ban className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    onClick={handleSend}
                    disabled={(!canType && !sessionReady) || !inputText.trim()}
                    className="min-h-[44px] min-w-[44px]"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {(modeOption || modelOption) && (
              <div className="flex items-center gap-2 mt-2">
                {modeOption && (
                  <button
                    type="button"
                    onClick={cycleMode}
                    disabled={!sessionRunning}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors min-h-[28px] disabled:opacity-50 ${MODE_BADGE_STYLES[currentMode] ?? 'bg-muted text-muted-foreground'}`}
                  >
                    {modeOption.options.find(o => o.value === currentMode)?.label ?? currentMode}
                  </button>
                )}
                {modelOption && (
                  <ConfigOptionPicker
                    option={modelOption}
                    onValueChange={handleConfigChange}
                    disabled={!sessionRunning}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

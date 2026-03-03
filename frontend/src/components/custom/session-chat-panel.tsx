import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, RotateCcw, Archive, ChevronsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActivityGroup } from '@/components/custom/activity-group';
import { ChatBubble } from '@/components/custom/chat-bubble';
import { SESSION_STATE_DOT, isSessionActive, isSessionTerminal } from '@/lib/chat-utils';
import type { ChatItem } from '@/lib/chat-utils';
import type { AgentSession, PendingApproval, ApprovalDecision } from '@agemon/shared';

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
              aria-label="Archive session"
              onClick={() => onStop(session.id)}
              disabled={actionLoading}
              className="gap-1.5"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
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
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={inputPlaceholder}
              disabled={!canType && !sessionReady}
              className="flex-1 min-h-[44px]"
            />
            <Button
              type="submit"
              size="icon"
              disabled={(!canType && !sessionReady) || !inputText.trim()}
              className="min-h-[44px] min-w-[44px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

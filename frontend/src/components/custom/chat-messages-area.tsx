import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsDown, ChevronsUp, Loader2 } from 'lucide-react';
import { ActivityGroup } from '@/components/custom/activity-group';
import { ChatBubble } from '@/components/custom/chat-bubble';
import { ToolCardShell } from '@/components/custom/tool-cards/tool-card-shell';
import { isSessionActive } from '@/lib/chat-utils';
import { useWsStore } from '@/lib/store';
import { EMPTY_TOOL_CALLS } from '@/lib/tool-call-helpers';
import type { ChatItem } from '@/lib/chat-utils';
import type { AgentSessionState, PendingApproval, ApprovalDecision } from '@agemon/shared';

/** Subscribes to a single tool call by ID — only re-renders when that entry changes. */
const ToolCallCardItem = memo(function ToolCallCardItem({ toolCallId, sessionId }: { toolCallId: string; sessionId: string }) {
  const toolCall = useWsStore((s) => {
    const list = s.toolCalls[sessionId] ?? EMPTY_TOOL_CALLS;
    return list.find((tc) => tc.toolCallId === toolCallId) ?? null;
  });
  if (!toolCall) return null;
  return <ToolCardShell toolCall={toolCall} />;
});

function itemKey(item: ChatItem): string {
  if (item.kind === 'activity-group') return `ag-${item.messages[0].id}`;
  if (item.kind === 'tool-call') return `tc-${item.toolCallId}`;
  return item.message.id;
}

/** Get the key of the last item — used to detect appends vs prepends. */
function lastItemKey(items: ChatItem[]): string | null {
  return items.length > 0 ? itemKey(items[items.length - 1]) : null;
}

export const ChatMessagesArea = memo(function ChatMessagesArea({
  sessionReady,
  sessionRunning,
  sessionState,
  selectedSessionId,
  groupedItems,
  agentActivity,
  approvalLookup,
  onApprovalDecision,
  connected,
  isLoadingMore,
  hasMore,
  onFetchOlderMessages,
}: {
  sessionReady: boolean;
  sessionRunning: boolean;
  sessionState: AgentSessionState;
  selectedSessionId: string | null;
  groupedItems: ChatItem[];
  agentActivity: string | null;
  approvalLookup: Map<string, PendingApproval>;
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  connected: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onFetchOlderMessages?: () => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const isNearBottomRef = useRef(true);
  // Track last-item key and length to distinguish appends from prepends
  const prevLastKeyRef = useRef(lastItemKey(groupedItems));
  const prevLengthRef = useRef(groupedItems.length);

  // Track whether user is near the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessages(false);
  }, []);

  // Handle scroll behavior when items change
  useEffect(() => {
    const curLastKey = lastItemKey(groupedItems);
    const wasAppend = curLastKey !== prevLastKeyRef.current && groupedItems.length > prevLengthRef.current;
    // Prepend (older messages): overflow-anchor: auto handles scroll preservation.

    if (wasAppend) {
      // New messages at the bottom
      if (isNearBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        setShowNewMessages(true);
      }
    }
    // Prepend (older messages loaded): overflow-anchor: auto handles scroll preservation.

    prevLastKeyRef.current = curLastKey;
    prevLengthRef.current = groupedItems.length;
  }, [groupedItems]);

  // Scroll to bottom on initial mount / session switch
  useEffect(() => {
    // Use rAF to ensure DOM has rendered the new session's messages
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView();
    });
  }, [selectedSessionId]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMessages(false);
  }, []);

  const renderItem = useCallback((item: ChatItem, isLast: boolean) => {
    if (item.kind === 'activity-group') {
      return (
        <ActivityGroup
          messages={item.messages}
          isLast={isLast}
          sessionId={selectedSessionId}
          approvalLookup={approvalLookup}
          onApprovalDecision={onApprovalDecision}
          connected={connected}
        />
      );
    }
    if (item.kind === 'tool-call') {
      return <ToolCallCardItem toolCallId={item.toolCallId} sessionId={item.sessionId} />;
    }
    return (
      <ChatBubble
        message={item.message}
        approvalLookup={approvalLookup}
        onApprovalDecision={onApprovalDecision}
        connected={connected}
      />
    );
  }, [selectedSessionId, approvalLookup, onApprovalDecision, connected]);

  if (groupedItems.length === 0) {
    return (
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center justify-center h-full px-4 py-3">
          <p className="text-muted-foreground text-sm">
            {sessionReady
              ? 'Session ready. Send your first message.'
              : isSessionActive(sessionState)
                ? 'Waiting for agent output...'
                : 'No messages in this session.'}
          </p>
        </div>
      </div>
    );
  }

  const showActivity = agentActivity && sessionRunning && !agentActivity.startsWith('Waiting for approval');

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain px-1"
        style={{ overflowAnchor: 'auto' }}
      >
        {/* Load older messages button */}
        {hasMore && onFetchOlderMessages && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={onFetchOlderMessages}
              disabled={isLoadingMore}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-muted text-muted-foreground text-xs font-medium hover:bg-accent hover:text-foreground transition-colors min-h-[44px]"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <ChevronsUp className="h-3.5 w-3.5" />
                  Load older messages
                </>
              )}
            </button>
          </div>
        )}

        {/* Messages */}
        {groupedItems.map((item, idx) => (
          <div key={itemKey(item)}>{renderItem(item, idx === groupedItems.length - 1)}</div>
        ))}

        {/* Activity indicator */}
        {showActivity && (
          <div className="flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
            </span>
            <span className="truncate animate-pulse">{agentActivity}</span>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* New messages pill */}
      {showNewMessages && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors min-h-[44px]"
        >
          <ChevronsDown className="h-3.5 w-3.5" />
          New messages
        </button>
      )}
    </div>
  );
});

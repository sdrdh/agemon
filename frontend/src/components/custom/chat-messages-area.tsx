import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChevronsDown, Loader2 } from 'lucide-react';
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

/** Large start index so prepends don't go negative. */
const START_INDEX = 100_000;

/** Stable Header component — receives isLoadingMore via context (Virtuoso re-mounts if reference changes). */
const ListHeader = memo(function ListHeader({ context }: { context?: { isLoadingMore?: boolean } }) {
  if (!context?.isLoadingMore) return null;
  return (
    <div className="flex items-center justify-center py-3">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
    </div>
  );
});

/** Stable Footer component — renders agent activity indicator. */
const ListFooter = memo(function ListFooter({ context }: { context?: { agentActivity: string | null; sessionRunning: boolean } }) {
  const { agentActivity, sessionRunning } = context ?? { agentActivity: null, sessionRunning: false };
  if (!agentActivity || !sessionRunning || agentActivity.startsWith('Waiting for approval')) return null;
  return (
    <div className="flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
      </span>
      <span className="truncate">{agentActivity}</span>
    </div>
  );
});

const STABLE_COMPONENTS = { Header: ListHeader, Footer: ListFooter };

export function ChatMessagesArea({
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
  virtuosoRef,
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
  virtuosoRef: React.RefObject<VirtuosoHandle>;
}) {
  const [showNewMessages, setShowNewMessages] = useState(false);

  // firstItemIndex should only change on prepend, not on append.
  // Track the baseline count at which firstItemIndex was last set.
  const baselineRef = useRef(groupedItems.length);
  const firstItemIndexRef = useRef(START_INDEX - groupedItems.length);

  // On prepend: items were added before baseline, shift firstItemIndex down
  // On append/regroup: baseline grows, firstItemIndex stays the same
  if (groupedItems.length > baselineRef.current) {
    // Could be prepend or append — check if firstItemIndex needs adjustment
    // Virtuoso guarantees: if firstItemIndex decreases, it's a prepend
    const newFirstIndex = START_INDEX - groupedItems.length;
    if (newFirstIndex < firstItemIndexRef.current) {
      firstItemIndexRef.current = newFirstIndex;
    }
    baselineRef.current = groupedItems.length;
  } else if (groupedItems.length < baselineRef.current) {
    // Items removed (regroup collapse) — recalculate
    baselineRef.current = groupedItems.length;
    firstItemIndexRef.current = START_INDEX - groupedItems.length;
  }

  // Use refs for atTopStateChange to avoid stale closures and callback recreation
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const fetchRef = useRef(onFetchOlderMessages);
  hasMoreRef.current = hasMore;
  isLoadingMoreRef.current = isLoadingMore;
  fetchRef.current = onFetchOlderMessages;

  const handleAtTopStateChange = useCallback((atTop: boolean) => {
    if (atTop && hasMoreRef.current && !isLoadingMoreRef.current && fetchRef.current) {
      fetchRef.current();
    }
  }, []);

  const isAtBottomRef = useRef(true);
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (atBottom) setShowNewMessages(false);
  }, []);

  // Show "New messages" when items are appended and user isn't at bottom
  const prevLengthRef = useRef(groupedItems.length);
  useEffect(() => {
    if (groupedItems.length > prevLengthRef.current && !isAtBottomRef.current) {
      const expectedAppendFirst = START_INDEX - groupedItems.length;
      if (expectedAppendFirst >= firstItemIndexRef.current) {
        setShowNewMessages(true);
      }
    }
    prevLengthRef.current = groupedItems.length;
  }, [groupedItems.length]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
    setShowNewMessages(false);
  }, [virtuosoRef]);

  const renderItem = useCallback((_index: number, item: ChatItem) => {
    if (item.kind === 'activity-group') {
      return <ActivityGroup messages={item.messages} isLast={false} sessionId={selectedSessionId} />;
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

  // Stable key computation for Virtuoso — uses item identity rather than index
  const computeItemKey = useCallback((_index: number, item: ChatItem) => {
    if (item.kind === 'activity-group') return `ag-${item.messages[0].id}`;
    if (item.kind === 'tool-call') return `tc-${item.toolCallId}`;
    return item.message.id;
  }, []);

  // Context for Header/Footer (avoids inline component recreation)
  const context = useMemo(() => ({
    isLoadingMore,
    agentActivity,
    sessionRunning,
  }), [isLoadingMore, agentActivity, sessionRunning]);

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

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        data={groupedItems}
        defaultItemHeight={80}
        firstItemIndex={firstItemIndexRef.current}
        initialTopMostItemIndex={groupedItems.length - 1}
        itemContent={renderItem}
        computeItemKey={computeItemKey}
        alignToBottom
        followOutput="auto"
        atTopStateChange={handleAtTopStateChange}
        atBottomStateChange={handleAtBottomStateChange}
        className="h-full"
        overscan={{ main: 300, reverse: 300 }}
        context={context}
        components={STABLE_COMPONENTS}
        increaseViewportBy={{ top: 200, bottom: 100 }}
      />

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
  );
}

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
function ToolCallCardItem({ toolCallId, sessionId }: { toolCallId: string; sessionId: string }) {
  const toolCall = useWsStore((s) => {
    const list = s.toolCalls[sessionId] ?? EMPTY_TOOL_CALLS;
    return list.find((tc) => tc.toolCallId === toolCallId) ?? null;
  });
  if (!toolCall) return null;
  return <ToolCardShell toolCall={toolCall} />;
}

export function ChatMessagesArea({
  sessionReady,
  sessionRunning,
  sessionState,
  selectedSessionId,
  groupedItems,
  agentActivity,
  showNewMessages,
  scrollContainerRef,
  chatEndRef,
  approvalLookup,
  onScroll,
  onApprovalDecision,
  scrollToBottom,
  connected,
  isLoadingMore,
}: {
  sessionReady: boolean;
  sessionRunning: boolean;
  sessionState: AgentSessionState;
  selectedSessionId: string | null;
  groupedItems: ChatItem[];
  agentActivity: string | null;
  showNewMessages: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  chatEndRef: React.RefObject<HTMLDivElement>;
  approvalLookup: Map<string, PendingApproval>;
  onScroll: () => void;
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  scrollToBottom: () => void;
  connected: boolean;
  isLoadingMore?: boolean;
}) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 py-3"
      >
        {isLoadingMore && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
          </div>
        )}

        {groupedItems.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              {sessionReady
                ? 'Session ready. Send your first message.'
                : isSessionActive(sessionState)
                  ? 'Waiting for agent output...'
                  : 'No messages in this session.'}
            </p>
          </div>
        )}

        {groupedItems.map((item, idx) => {
          if (item.kind === 'activity-group') {
            return <ActivityGroup key={`ag-${item.messages[0].id}`} messages={item.messages} isLast={idx === groupedItems.length - 1} sessionId={selectedSessionId} />;
          }
          if (item.kind === 'tool-call') {
            return <ToolCallCardItem key={`tc-${item.toolCallId}`} toolCallId={item.toolCallId} sessionId={item.sessionId} />;
          }
          return (
            <ChatBubble
              key={item.message.id}
              message={item.message}
              approvalLookup={approvalLookup}
              onApprovalDecision={onApprovalDecision}
              connected={connected}
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

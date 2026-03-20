import { useMemo } from 'react';
import type { PendingApproval, ApprovalDecision, AgentSession, Task, ChatMessage } from '@agemon/shared';
import type { PendingInput } from '@/lib/store';
import { useWsStore } from '@/lib/store';
import { DashboardApprovalCard } from './dashboard-approval-card';
import { QuestionInputCard } from './question-input-card';

interface NeedsInputSectionProps {
  approvals: PendingApproval[];
  inputs: PendingInput[];
  taskMap: Map<string, Task>;
  sessionMap: Map<string, AgentSession>;
  connected: boolean;
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  onInputSubmit: (inputId: string, taskId: string, response: string) => void;
  onNavigateToTask: (taskId: string, sessionId?: string) => void;
  onStopSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string) => void;
}

/** Get the last meaningful message for a session — agent thought or user message. */
function getLastMessage(chatMessages: Record<string, ChatMessage[]>, sessionId: string): { text: string; role: 'agent' | 'user' } | undefined {
  const messages = chatMessages[sessionId];
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.content && msg.content.length > 0) {
      if ((msg.role === 'agent' && msg.eventType === 'thought') || msg.role === 'user') {
        const text = msg.content.length > 200 ? msg.content.slice(0, 200) + '…' : msg.content;
        return { text, role: msg.role as 'agent' | 'user' };
      }
    }
  }
  return undefined;
}

export function NeedsInputSection({
  approvals,
  inputs,
  taskMap,
  sessionMap,
  connected,
  onApprovalDecision,
  onInputSubmit,
  onNavigateToTask,
  onStopSession,
  onArchiveSession,
}: NeedsInputSectionProps) {
  const chatMessages = useWsStore((s) => s.chatMessages);
  const sorted = useMemo(() => {
    const approvalItems = approvals.map((a) => ({
      type: 'approval' as const,
      timestamp: new Date(a.createdAt).getTime(),
      item: a,
    }));
    const inputItems = inputs.map((i) => ({
      type: 'input' as const,
      timestamp: i.receivedAt,
      item: i,
    }));
    return [...approvalItems, ...inputItems].sort((a, b) => b.timestamp - a.timestamp);
  }, [approvals, inputs]);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing blocked right now.</p>;
  }

  return (
    <div className="space-y-2">
      {sorted.map((entry) => {
          if (entry.type === 'approval') {
            const approval = entry.item as PendingApproval;
            const task = taskMap.get(approval.taskId);
            const taskName = task?.title ?? 'Unknown task';
            const taskDescription = task?.description ?? undefined;
            const agentType = sessionMap.get(approval.sessionId)?.agent_type ?? 'claude-code';
            const lastMessage = getLastMessage(chatMessages, approval.sessionId);
            return (
              <DashboardApprovalCard
                key={approval.id}
                approval={approval}
                taskName={taskName}
                taskDescription={taskDescription}
                lastMessage={lastMessage}
                agentType={agentType}
                connected={connected}
                onDecision={onApprovalDecision}
                onNavigate={() => onNavigateToTask(approval.taskId, approval.sessionId)}
                onStop={onStopSession}
                onArchive={onArchiveSession}
              />
            );
          } else {
            const input = entry.item as PendingInput;
            const task = taskMap.get(input.taskId);
            const taskName = task?.title ?? 'Unknown task';
            const taskDescription = task?.description ?? undefined;
            const agentType = sessionMap.get(input.sessionId)?.agent_type ?? 'claude-code';
            const lastMessage = getLastMessage(chatMessages, input.sessionId);
            return (
              <QuestionInputCard
                key={input.inputId}
                input={input}
                taskName={taskName}
                taskDescription={taskDescription}
                lastMessage={lastMessage}
                agentType={agentType}
                connected={connected}
                onSubmit={onInputSubmit}
                onNavigate={() => onNavigateToTask(input.taskId, input.sessionId)}
                onStop={onStopSession}
                onArchive={onArchiveSession}
              />
            );
          }
        })}
    </div>
  );
}

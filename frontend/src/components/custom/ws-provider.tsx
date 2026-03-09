import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys, sessionKeys } from '@/lib/query';
import type { ServerEvent } from '@agemon/shared';

/** Extract a short activity label from a tool-call content string. */
function parseToolActivity(content: string): string {
  // Handles both [tool] and [tool:toolCallId] formats
  if (content.startsWith('[tool update]')) return ''; // skip updates
  const match = content.match(/^\[tool(?::[^\]]+)?\]\s+(\S+)\s+(.*?)(?:\s*\((?:pending|in_progress)\))?$/);
  if (!match) return 'Running tool...';

  const toolName = match[1];
  const arg = match[2]?.trim() ?? '';

  // Extract just the filename from long paths
  const shortArg = arg.includes('/') ? arg.split('/').pop()?.replace(/\s*\(.*$/, '') ?? '' : arg;

  switch (toolName) {
    case 'Read': return shortArg ? `Reading ${shortArg}` : 'Reading file...';
    case 'Edit': return shortArg ? `Editing ${shortArg}` : 'Editing file...';
    case 'Write': return shortArg ? `Writing ${shortArg}` : 'Writing file...';
    case 'Glob':
    case 'Grep':
    case 'Search': return 'Searching...';
    case 'Bash':
    case 'bash': return 'Running command...';
    case 'WebSearch':
    case 'web_search': return 'Searching the web...';
    default: return shortArg ? `${toolName} ${shortArg}` : `Running ${toolName}...`;
  }
}

/**
 * Subscribes to WebSocket events once on mount and bridges them to
 * React Query cache + Zustand store. Events are keyed by sessionId.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = useWsStore.getState;

    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          queryClient.setQueryData(taskKeys.detail(task.id), task);
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          queryClient.invalidateQueries({ queryKey: taskKeys.listsPrefix() });
          // Also invalidate session queries — task_updated is broadcast on session archive
          queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(task.id) });
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          break;
        }
        case 'agent_thought': {
          const msgId = event.messageId ?? crypto.randomUUID();
          store().appendChatMessage(event.sessionId, {
            id: msgId,
            role: 'agent',
            content: event.content,
            eventType: event.eventType ?? 'thought',
            timestamp: new Date().toISOString(),
          });
          store().markUnread(event.sessionId);

          if (event.eventType === 'thought') {
            store().setAgentActivity(event.sessionId, 'Thinking...');
          } else if (event.eventType === 'action') {
            if (event.content.startsWith('[tool]') || event.content.startsWith('[tool:')) {
              const label = parseToolActivity(event.content);
              if (label) store().setAgentActivity(event.sessionId, label);
            } else if (event.content.startsWith('[tool update]')) {
              store().setAgentActivity(event.sessionId, null);
            } else {
              // Regular text — the chat bubble itself is the indicator
              store().setAgentActivity(event.sessionId, null);
            }
          }
          break;
        }
        case 'awaiting_input': {
          store().appendChatMessage(event.sessionId, {
            id: event.inputId,
            role: 'agent',
            content: event.question,
            eventType: 'input_request',
            timestamp: new Date().toISOString(),
          });
          store().addPendingInput({
            inputId: event.inputId,
            taskId: event.taskId,
            sessionId: event.sessionId,
            question: event.question,
            receivedAt: Date.now(),
          });
          store().markUnread(event.sessionId);
          store().setAgentActivity(event.sessionId, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          break;
        }
        case 'session_started': {
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          break;
        }
        case 'session_ready': {
          store().setAgentActivity(event.session.id, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          break;
        }
        case 'session_state_changed': {
          const stateMessages: Record<string, string> = {
            stopped: 'Session ended',
            crashed: 'Session crashed',
            interrupted: 'Session interrupted (server restart)',
          };
          const msg = stateMessages[event.state];
          if (msg) {
            store().appendChatMessage(event.sessionId, {
              id: crypto.randomUUID(),
              role: 'system',
              content: msg,
              eventType: 'status',
              timestamp: new Date().toISOString(),
            });
          }
          store().setAgentActivity(event.sessionId, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          break;
        }
        case 'approval_requested': {
          store().addPendingApproval(event.approval);
          // Insert a chat message marker so the approval renders inline in the timeline
          store().appendChatMessage(event.approval.sessionId, {
            id: `approval-${event.approval.id}`,
            role: 'system',
            content: `${event.approval.id}:${event.approval.status}:${event.approval.toolName}`,
            eventType: 'approval_request',
            timestamp: event.approval.createdAt,
          });
          store().setAgentActivity(event.approval.sessionId, `Waiting for approval: ${event.approval.toolName}`);
          store().markUnread(event.approval.sessionId);
          break;
        }
        case 'approval_resolved': {
          store().resolvePendingApproval(event.approvalId, event.decision);
          // Find the approval to clear activity on the right session
          const approval = store().pendingApprovals.find(a => a.id === event.approvalId);
          if (approval) {
            store().setAgentActivity(approval.sessionId, null);
          }
          break;
        }
        case 'config_options_updated': {
          store().setConfigOptions(event.sessionId, event.configOptions);
          break;
        }
        case 'available_commands': {
          store().setAvailableCommands(event.sessionId, event.commands);
          break;
        }
        case 'turn_cancelled': {
          store().setTurnInFlight(event.sessionId, false);
          store().appendChatMessage(event.sessionId, {
            id: crypto.randomUUID(),
            role: 'system',
            content: 'Turn cancelled',
            eventType: 'status',
            timestamp: new Date().toISOString(),
          });
          store().setAgentActivity(event.sessionId, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          break;
        }
        case 'turn_completed': {
          store().setTurnInFlight(event.sessionId, false);
          store().setAgentActivity(event.sessionId, null);
          break;
        }
      }
    });

    const unsubConn = onConnectionChange((connected) => {
      store().setConnected(connected);
    });

    return () => {
      unsubEvent();
      unsubConn();
    };
  }, []);

  return <>{children}</>;
}

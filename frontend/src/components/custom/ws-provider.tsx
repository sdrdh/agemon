import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys, sessionKeys } from '@/lib/query';
import type { ServerEvent } from '@agemon/shared';

/** Extract a short activity label from a tool-call content string. */
function parseToolActivity(content: string): string {
  // content looks like: "[tool] Read /long/path/to/file.ts (1 - 80) (pending)"
  // or "[tool update] toolu_xxx: completed"
  if (content.startsWith('[tool update]')) return ''; // skip updates
  const match = content.match(/^\[tool\]\s+(\S+)\s+(.*?)(?:\s*\((?:pending|in_progress)\))?$/);
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
 * React Query cache + Zustand store. Uses module-level queryClient
 * and Zustand getState() to avoid React render dependencies.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = useWsStore.getState;

    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          queryClient.setQueryData(taskKeys.detail(task.id), task);
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
          queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
          break;
        }
        case 'agent_thought': {
          // Use messageId for streaming chunk accumulation; random ID for one-shot events
          const msgId = event.messageId ?? crypto.randomUUID();
          store().appendChatMessage(event.taskId, {
            id: msgId,
            role: 'agent',
            content: event.content,
            eventType: event.eventType ?? 'thought',
            timestamp: new Date().toISOString(),
          });

          // Update agent activity indicator
          if (event.eventType === 'thought') {
            store().setAgentActivity(event.taskId, 'Thinking...');
          } else if (event.eventType === 'action') {
            if (event.content.startsWith('[tool]')) {
              const label = parseToolActivity(event.content);
              if (label) store().setAgentActivity(event.taskId, label);
            } else if (!event.content.startsWith('[tool update]')) {
              store().setAgentActivity(event.taskId, 'Writing...');
            }
          }
          break;
        }
        case 'awaiting_input': {
          store().appendChatMessage(event.taskId, {
            id: event.inputId,
            role: 'agent',
            content: event.question,
            eventType: 'input_request',
            timestamp: new Date().toISOString(),
          });
          store().addPendingInput({
            inputId: event.inputId,
            taskId: event.taskId,
            question: event.question,
            receivedAt: Date.now(),
          });
          store().setAgentActivity(event.taskId, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'session_started': {
          store().appendChatMessage(event.taskId, {
            id: crypto.randomUUID(),
            role: 'system',
            content: 'Agent started',
            eventType: 'status',
            timestamp: new Date().toISOString(),
          });
          store().setAgentActivity(event.taskId, 'Starting...');
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
          break;
        }
        case 'session_state_changed': {
          const stateMessages: Record<string, string> = {
            stopped: 'Agent stopped',
            crashed: 'Agent crashed',
            interrupted: 'Agent session interrupted (server restart)',
          };
          const msg = stateMessages[event.state];
          if (msg) {
            store().appendChatMessage(event.taskId, {
              id: crypto.randomUUID(),
              role: 'system',
              content: msg,
              eventType: 'status',
              timestamp: new Date().toISOString(),
            });
          }
          store().setAgentActivity(event.taskId, null);
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
          queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
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

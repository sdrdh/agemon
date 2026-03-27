import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/events';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys, sessionKeys, dashboardKeys } from '@/lib/query';
import { applyToolCallEvent } from '@/lib/tool-call-helpers';
import { api } from '@/lib/api';
import { invalidateRendererCache } from '@/components/custom/chat-bubble';
import type { ServerEvent } from '@agemon/shared';

/** Shorten a file path to just the filename. */
function shortFile(path: string): string {
  return path.includes('/') ? path.split('/').pop()?.replace(/\s*\(.*$/, '') ?? '' : path;
}

/** Build an activity label from tool kind + args (structured JSON format). */
function structuredToolActivity(kind: string, args?: Record<string, string>): string {
  const file = args?.filePath || args?.file_path || args?.path || '';
  const short = file ? shortFile(file) : '';
  switch (kind) {
    case 'Read': return short ? `Reading ${short}` : 'Reading file...';
    case 'Edit': return short ? `Editing ${short}` : 'Editing file...';
    case 'Write': return short ? `Writing ${short}` : 'Writing file...';
    case 'Glob':
    case 'Grep':
    case 'Search': return 'Searching...';
    case 'Bash':
    case 'bash': return 'Running command...';
    case 'WebSearch':
    case 'web_search': return 'Searching the web...';
    case 'WebFetch':
    case 'web_fetch': return 'Fetching page...';
    case 'Agent': return 'Running agent...';
    case 'Skill': return 'Running skill...';
    default: return short ? `${kind} ${short}` : `Running ${kind}...`;
  }
}

/** Extract a short activity label from a legacy tool-call content string. */
function parseToolActivity(content: string): string {
  if (content.startsWith('[tool update]')) return '';
  const match = content.match(/^\[tool(?::[^\]]+)?\]\s+(\S+)\s+(.*?)(?:\s*\((?:pending|in_progress)\))?$/);
  if (!match) return 'Running tool...';
  return structuredToolActivity(match[1], { filePath: match[2]?.trim() ?? '' });
}

/**
 * Subscribes to SSE events once on mount and bridges them to
 * React Query cache + Zustand store.
 *
 * On SSE reconnect (EventSource auto-reconnects on error), React Query is
 * invalidated to refetch authoritative state from REST endpoints.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = useWsStore.getState;

    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          queryClient.setQueryData(taskKeys.detail(task.id), task);
          queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          queryClient.invalidateQueries({ queryKey: taskKeys.listsPrefix() });
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

          let parsed: Record<string, unknown> | null = null;
          if (event.eventType === 'action') {
            try { parsed = JSON.parse(event.content); } catch { /* not JSON */ }
            if (parsed && typeof parsed.toolCallId === 'string') {
              applyToolCallEvent(parsed, event.sessionId, store().upsertToolCall);
            }
          }

          if (event.eventType === 'thought') {
            store().setAgentActivity(event.sessionId, 'Thinking...');
          } else if (event.eventType === 'action') {
            if (event.content.startsWith('[tool]') || event.content.startsWith('[tool:')) {
              const label = parseToolActivity(event.content);
              if (label) store().setAgentActivity(event.sessionId, label);
            } else if (event.content.startsWith('[tool update]')) {
              store().setAgentActivity(event.sessionId, null);
            } else if (parsed?.toolCallId && !parsed.isUpdate) {
              const label = structuredToolActivity(parsed.kind as string, parsed.args as Record<string, string> | undefined);
              if (label) store().setAgentActivity(event.sessionId, label);
            } else if (!parsed?.toolCallId) {
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
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          }
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'session_started': {
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          break;
        }
        case 'session_ready': {
          store().setAgentActivity(event.session.id, null);
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
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
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
            queryClient.invalidateQueries({ queryKey: sessionKeys.forTaskPrefix(event.taskId) });
          }
          queryClient.invalidateQueries({ queryKey: sessionKeys.listPrefix() });
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'approval_requested': {
          store().addPendingApproval(event.approval);
          store().appendChatMessage(event.approval.sessionId, {
            id: `approval-${event.approval.id}`,
            role: 'system',
            content: `${event.approval.id}:${event.approval.status}:${event.approval.toolName}`,
            eventType: 'approval_request',
            timestamp: event.approval.createdAt,
          });
          store().setAgentActivity(event.approval.sessionId, `Waiting for approval: ${event.approval.toolName}`);
          store().markUnread(event.approval.sessionId);
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'approval_resolved': {
          store().resolvePendingApproval(event.approvalId, event.decision);
          const approval = store().pendingApprovals.find(a => a.id === event.approvalId);
          if (approval) store().setAgentActivity(approval.sessionId, null);
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
          if (event.taskId) {
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
            queryClient.invalidateQueries({ queryKey: taskKeys.byProjectPrefix() });
          }
          break;
        }
        case 'turn_completed': {
          store().setTurnInFlight(event.sessionId, false);
          store().setAgentActivity(event.sessionId, null);
          queryClient.invalidateQueries({ queryKey: dashboardKeys.active });
          break;
        }
        case 'session_usage_update': {
          store().setSessionUsage(event.sessionId, event.usage);
          break;
        }
        case 'update_available': {
          useWsStore.getState().setUpdateAvailable(true);
          break;
        }
        case 'extensions_changed': {
          invalidateRendererCache();
          store().bumpPluginsRevision();
          break;
        }
        case 'server_restarting': {
          console.info('[sse] server is restarting...');
          break;
        }
      }
    });

    // On SSE reconnect, invalidate all queries so REST data is refreshed.
    const unsubConn = onConnectionChange((connected) => {
      store().setConnected(connected);
      if (connected) {
        queryClient.invalidateQueries();
      }
    });

    api.checkForUpdates().then(result => {
      if (result.should_notify) useWsStore.getState().setUpdateAvailable(true);
    }).catch((err) => { console.warn('[events-provider] initial update check failed:', err); });

    return () => {
      unsubEvent();
      unsubConn();
    };
  }, []);

  return <>{children}</>;
}

import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys, sessionKeys } from '@/lib/query';
import type { ServerEvent } from '@agemon/shared';

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
          store().appendChatMessage(event.taskId, {
            id: crypto.randomUUID(),
            role: 'agent',
            content: event.content,
            eventType: event.eventType ?? 'thought',
            timestamp: new Date().toISOString(),
          });
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

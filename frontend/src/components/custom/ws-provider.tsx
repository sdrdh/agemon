import { useEffect, type ReactNode } from 'react';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { queryClient, taskKeys } from '@/lib/query';
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
          break;
        }
        case 'agent_thought': {
          store().appendThought(event.taskId, event.content);
          queryClient.invalidateQueries({ queryKey: taskKeys.events(event.taskId) });
          break;
        }
        case 'awaiting_input': {
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
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'session_state_changed': {
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.byProject() });
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

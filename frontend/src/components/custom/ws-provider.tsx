import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { taskKeys } from '@/lib/query';
import type { ServerEvent } from '@agemon/shared';

export function WsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setConnected = useWsStore((s) => s.setConnected);
  const appendThought = useWsStore((s) => s.appendThought);
  const addPendingInput = useWsStore((s) => s.addPendingInput);

  useEffect(() => {
    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          qc.setQueryData(taskKeys.detail(task.id), task);
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'agent_thought': {
          appendThought(event.taskId, event.content);
          qc.invalidateQueries({ queryKey: taskKeys.events(event.taskId) });
          break;
        }
        case 'awaiting_input': {
          addPendingInput({
            inputId: event.inputId,
            taskId: event.taskId,
            question: event.question,
            receivedAt: Date.now(),
          });
          qc.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'session_started': {
          qc.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'session_state_changed': {
          // session_state_changed only has sessionId, not taskId — invalidate all
          qc.invalidateQueries({ queryKey: taskKeys.all });
          break;
        }
      }
    });

    const unsubConn = onConnectionChange(setConnected);

    return () => {
      unsubEvent();
      unsubConn();
    };
  }, [qc, setConnected, appendThought, addPendingInput]);

  return <>{children}</>;
}

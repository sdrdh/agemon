import { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, TasksByProject, ACPEvent, ChatMessage, AgentSession } from '@agemon/shared';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export const taskKeys = {
  all: ['tasks'] as const,
  byProject: () => [...taskKeys.all, 'by-project'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  events: (id: string) => [...taskKeys.all, 'events', id] as const,
  chat: (id: string) => [...taskKeys.all, 'chat', id] as const,
};

export function tasksListQuery() {
  return {
    queryKey: taskKeys.lists(),
    queryFn: (): Promise<Task[]> => api.listTasks(),
  };
}

export function tasksByProjectQuery() {
  return {
    queryKey: taskKeys.byProject(),
    queryFn: (): Promise<TasksByProject> => api.listTasksByProject(),
  };
}

export function taskDetailQuery(id: string) {
  return {
    queryKey: taskKeys.detail(id),
    queryFn: (): Promise<Task> => api.getTask(id),
    enabled: !!id,
  };
}

export function taskEventsQuery(id: string, limit = 500) {
  return {
    queryKey: taskKeys.events(id),
    queryFn: (): Promise<ACPEvent[]> => api.listEvents(id, limit),
    enabled: !!id,
  };
}

export function taskChatQuery(id: string, limit = 500) {
  return {
    queryKey: taskKeys.chat(id),
    queryFn: (): Promise<ChatMessage[]> => api.getChatHistory(id, limit),
    enabled: !!id,
  };
}

export const sessionKeys = {
  all: ['sessions'] as const,
  list: () => [...sessionKeys.all, 'list'] as const,
};

export function sessionsListQuery(limit = 100) {
  return {
    queryKey: sessionKeys.list(),
    queryFn: (): Promise<AgentSession[]> => api.listSessions(limit),
  };
}

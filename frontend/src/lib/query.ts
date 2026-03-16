import { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, TasksByProject, ACPEvent, ChatHistoryResponse, AgentSession, DashboardActiveResponse } from '@agemon/shared';

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
  byProjectPrefix: () => [...taskKeys.all, 'by-project'] as const,
  byProject: (includeArchived?: boolean) => [...taskKeys.byProjectPrefix(), { includeArchived }] as const,
  listsPrefix: () => [...taskKeys.all, 'list'] as const,
  lists: (includeArchived?: boolean) => [...taskKeys.listsPrefix(), { includeArchived }] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  events: (id: string) => [...taskKeys.all, 'events', id] as const,
};

export function tasksListQuery(includeArchived = false) {
  return {
    queryKey: taskKeys.lists(includeArchived),
    queryFn: (): Promise<Task[]> => api.listTasks(includeArchived),
  };
}

export function tasksByProjectQuery(includeArchived = false) {
  return {
    queryKey: taskKeys.byProject(includeArchived),
    queryFn: (): Promise<TasksByProject> => api.listTasksByProject(includeArchived),
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

export const sessionKeys = {
  all: ['sessions'] as const,
  listPrefix: () => [...sessionKeys.all, 'list'] as const,
  list: (includeArchived?: boolean) => [...sessionKeys.listPrefix(), { includeArchived }] as const,
  forTaskPrefix: (taskId: string) => [...sessionKeys.all, 'task', taskId] as const,
  forTask: (taskId: string, includeArchived?: boolean) => [...sessionKeys.forTaskPrefix(taskId), { includeArchived }] as const,
  chat: (sessionId: string) => [...sessionKeys.all, 'chat', sessionId] as const,
};

export function sessionsListQuery(limit = 100, includeArchived = false) {
  return {
    queryKey: sessionKeys.list(includeArchived),
    queryFn: (): Promise<AgentSession[]> => api.listAllSessions(limit, includeArchived),
  };
}

export function taskSessionsQuery(taskId: string, includeArchived = false) {
  return {
    queryKey: sessionKeys.forTask(taskId, includeArchived),
    queryFn: (): Promise<AgentSession[]> => api.getTaskSessions(taskId, includeArchived),
    enabled: !!taskId,
  };
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  active: ['dashboard', 'active'] as const,
};

export function dashboardActiveQuery() {
  return {
    queryKey: dashboardKeys.active,
    queryFn: (): Promise<DashboardActiveResponse> => api.getDashboardActive(),
    staleTime: 10_000,
  };
}

export function sessionChatQuery(sessionId: string, limit = 50) {
  return {
    queryKey: sessionKeys.chat(sessionId),
    queryFn: (): Promise<ChatHistoryResponse> => api.getSessionChat(sessionId, limit),
    enabled: !!sessionId,
  };
}

import type { Task, CreateTaskBody, UpdateTaskBody, CreateSessionBody, Repo, TasksByProject, AgentSession, ACPEvent, ChatMessage } from '@agemon/shared';

const BASE = '/api';

export const STORAGE_KEY = 'agemon_key' as const;

function getKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getKey()}`,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    if (res.status === 401) {
      clearApiKey();
      window.location.reload();
      throw new Error('Session expired');
    }
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Validate key against the server. Returns true if valid. */
export async function validateKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const api = {
  // Tasks
  listTasks: () => request<Task[]>('/tasks'),
  listTasksByProject: () => request<TasksByProject>('/tasks/by-project'),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (body: CreateTaskBody) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: UpdateTaskBody) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  listRepos: () => request<Repo[]>('/repos'),
  listEvents: (id: string, limit = 500) => request<ACPEvent[]>(`/tasks/${id}/events?limit=${limit}`),

  // Sessions
  createSession: (taskId: string, body: CreateSessionBody = {}) =>
    request<AgentSession>(`/tasks/${taskId}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  getTaskSessions: (taskId: string) => request<AgentSession[]>(`/tasks/${taskId}/sessions`),
  getSessionChat: (sessionId: string, limit = 500) =>
    request<ChatMessage[]>(`/sessions/${sessionId}/chat?limit=${limit}`),
  resumeSession: (sessionId: string) =>
    request<AgentSession>(`/sessions/${sessionId}/resume`, { method: 'POST' }),
  stopSession: (sessionId: string) =>
    request<{ message: string; sessionId: string }>(`/sessions/${sessionId}/stop`, { method: 'POST' }),
  listAllSessions: (limit = 100) => request<AgentSession[]>(`/sessions?limit=${limit}`),

  // Legacy (kept for backward compat during transition)
  stopTask: (id: string) => request<{ message: string; sessionId: string }>(`/tasks/${id}/stop`, { method: 'POST' }),
};

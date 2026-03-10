import type { Task, CreateTaskBody, UpdateTaskBody, CreateSessionBody, Repo, TasksByProject, AgentSession, ACPEvent, ChatMessage, SessionConfigOption, McpServerEntry, CreateMcpServerBody, TestMcpServerBody, TestMcpServerResult, AgentCommand } from '@agemon/shared';

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
  listTasks: (includeArchived = false) => request<Task[]>(`/tasks${includeArchived ? '?archived=true' : ''}`),
  listTasksByProject: (includeArchived = false) => request<TasksByProject>(`/tasks/by-project${includeArchived ? '?archived=true' : ''}`),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (body: CreateTaskBody) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: UpdateTaskBody) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  listRepos: () => request<Repo[]>('/repos'),
  listEvents: (id: string, limit = 500) => request<ACPEvent[]>(`/tasks/${id}/events?limit=${limit}`),

  // Sessions
  createSession: (taskId: string, body: CreateSessionBody = {}) =>
    request<AgentSession>(`/tasks/${taskId}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  getTaskSessions: (taskId: string, includeArchived = false) =>
    request<AgentSession[]>(`/tasks/${taskId}/sessions${includeArchived ? '?archived=true' : ''}`),
  getSessionChat: (sessionId: string, limit = 500) =>
    request<ChatMessage[]>(`/sessions/${sessionId}/chat?limit=${limit}`),
  resumeSession: (sessionId: string) =>
    request<AgentSession>(`/sessions/${sessionId}/resume`, { method: 'POST' }),
  stopSession: (sessionId: string) =>
    request<{ message: string; sessionId: string }>(`/sessions/${sessionId}/stop`, { method: 'POST' }),
  listAllSessions: (limit = 100, includeArchived = false) =>
    request<AgentSession[]>(`/sessions?limit=${limit}${includeArchived ? '&archived=true' : ''}`),
  archiveSession: (sessionId: string, archived: boolean) =>
    request<AgentSession>(`/sessions/${sessionId}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) }),

  // Config options
  getSessionConfig: (sessionId: string) =>
    request<SessionConfigOption[]>(`/sessions/${sessionId}/config`),
  getSessionCommands: (sessionId: string) =>
    request<AgentCommand[]>(`/sessions/${sessionId}/commands`),
  setSessionConfig: (sessionId: string, configId: string, value: string) =>
    request<{ message: string }>(`/sessions/${sessionId}/config`, {
      method: 'POST',
      body: JSON.stringify({ configId, value }),
    }),

  // MCP Servers
  listGlobalMcpServers: () => request<McpServerEntry[]>('/mcp-servers'),
  addGlobalMcpServer: (body: CreateMcpServerBody) =>
    request<McpServerEntry>('/mcp-servers', { method: 'POST', body: JSON.stringify(body) }),
  removeGlobalMcpServer: (id: string) => request<void>(`/mcp-servers/${id}`, { method: 'DELETE' }),
  listTaskMcpServers: (taskId: string) =>
    request<{ global: McpServerEntry[]; task: McpServerEntry[] }>(`/tasks/${taskId}/mcp-servers`),
  addTaskMcpServer: (taskId: string, body: CreateMcpServerBody) =>
    request<McpServerEntry>(`/tasks/${taskId}/mcp-servers`, { method: 'POST', body: JSON.stringify(body) }),
  removeTaskMcpServer: (taskId: string, serverId: string) =>
    request<void>(`/tasks/${taskId}/mcp-servers/${serverId}`, { method: 'DELETE' }),
  testMcpServer: (body: TestMcpServerBody) =>
    request<TestMcpServerResult>('/mcp-servers/test', { method: 'POST', body: JSON.stringify(body) }),

  // Legacy (kept for backward compat during transition)
  stopTask: (id: string) => request<{ message: string; sessionId: string }>(`/tasks/${id}/stop`, { method: 'POST' }),
};

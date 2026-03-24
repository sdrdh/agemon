import type { Task, UpdateTaskBody, CreateSessionBody, Repo, TasksByProject, AgentSession, ACPEvent, ChatHistoryResponse, SessionConfigOption, McpServerEntry, CreateMcpServerBody, TestMcpServerBody, TestMcpServerResult, AgentCommand, VersionInfo, VersionCheckResult, UpdateResult, RestartResult, DashboardActiveResponse, InstalledSkill, SkillInstallResult, SkillPreviewResult, PendingApproval } from '@agemon/shared';

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

export async function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch { /* best effort */ }
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getKey()}`,
  };
}

/** Auth-only header for GET fetches that handle their own error handling. */
export function authHeaders(): Record<string, string> {
  const key = getKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
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

/** Set the auth cookie via POST /api/auth. Called after successful key validation. */
export async function setAuthCookie(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/auth`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    // Non-critical — Bearer header still works for SPA API calls
    console.warn('Failed to set auth cookie');
  }
}

export const api = {
  // Tasks (plugin: tasks → /api/plugins/tasks/*)
  listTasks: (includeArchived = false) => request<Task[]>(`/plugins/tasks/tasks${includeArchived ? '?archived=true' : ''}`),
  listTasksByProject: (includeArchived = false) => request<TasksByProject>(`/plugins/tasks/tasks/by-project${includeArchived ? '?archived=true' : ''}`),
  getTask: (id: string) => request<Task>(`/plugins/tasks/tasks/${id}`),
  updateTask: (id: string, body: UpdateTaskBody) => request<Task>(`/plugins/tasks/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listRepos: () => request<Repo[]>('/repos'),
  listEvents: (id: string, limit = 500) => request<ACPEvent[]>(`/plugins/tasks/tasks/${id}/events?limit=${limit}`),

  // Sessions
  createSession: (taskId: string, body: CreateSessionBody = {}) =>
    request<AgentSession>(`/tasks/${taskId}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  createRawSession: (body: { cwd: string; agentType?: string }) =>
    request<AgentSession>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  getTaskSessions: (taskId: string, includeArchived = false) =>
    request<AgentSession[]>(`/tasks/${taskId}/sessions${includeArchived ? '?archived=true' : ''}`),
  getSession: (sessionId: string) =>
    request<AgentSession>(`/sessions/${sessionId}`),
  getSessionChat: (sessionId: string, limit = 50, before?: string) =>
    request<ChatHistoryResponse>(
      `/sessions/${sessionId}/chat?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    ),
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

  // MCP Servers (plugin: mcp-config → /api/plugins/mcp-config/*)
  listGlobalMcpServers: () => request<McpServerEntry[]>('/plugins/mcp-config/mcp-servers'),
  addGlobalMcpServer: (body: CreateMcpServerBody) =>
    request<McpServerEntry>('/plugins/mcp-config/mcp-servers', { method: 'POST', body: JSON.stringify(body) }),
  removeGlobalMcpServer: (id: string) => request<void>(`/plugins/mcp-config/mcp-servers/${id}`, { method: 'DELETE' }),
  listTaskMcpServers: (taskId: string) =>
    request<{ global: McpServerEntry[]; task: McpServerEntry[] }>(`/plugins/mcp-config/tasks/${taskId}/mcp-servers`),
  addTaskMcpServer: (taskId: string, body: CreateMcpServerBody) =>
    request<McpServerEntry>(`/plugins/mcp-config/tasks/${taskId}/mcp-servers`, { method: 'POST', body: JSON.stringify(body) }),
  removeTaskMcpServer: (taskId: string, serverId: string) =>
    request<void>(`/plugins/mcp-config/tasks/${taskId}/mcp-servers/${serverId}`, { method: 'DELETE' }),
  testMcpServer: (body: TestMcpServerBody) =>
    request<TestMcpServerResult>('/plugins/mcp-config/mcp-servers/test', { method: 'POST', body: JSON.stringify(body) }),

  // System / Version
  getVersion: () =>
    fetch(`${BASE}/version`).then(r => r.json()) as Promise<VersionInfo>,
  checkForUpdates: (refresh = false) =>
    request<VersionCheckResult>(`/version/check${refresh ? '?refresh=true' : ''}`),
  applyUpdate: () =>
    request<UpdateResult>('/update', { method: 'POST' }),
  restart: () =>
    request<RestartResult>('/restart', { method: 'POST' }),
  rebuild: () =>
    request<{ ok: boolean; message: string }>('/rebuild', { method: 'POST' }),

  // Settings
  getSettings: () => request<Record<string, string>>('/settings'),
  getSetting: (key: string) => request<{ value: string | null }>(`/settings/${key}`),
  setSetting: (key: string, value: string) =>
    request<{ ok: boolean }>('/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),

  // Dashboard
  getDashboardActive: () => request<DashboardActiveResponse>('/dashboard/active'),

  // Skills (plugin: skills-manager → /api/plugins/skills-manager/*)
  listGlobalSkills: () => request<{ skills: InstalledSkill[] }>('/plugins/skills-manager/skills'),
  previewSkills: (source: string) =>
    request<SkillPreviewResult>('/plugins/skills-manager/skills/preview', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  installGlobalSkill: (source: string, skillNames?: string[]) =>
    request<SkillInstallResult>('/plugins/skills-manager/skills', {
      method: 'POST',
      body: JSON.stringify({ source, skillNames }),
    }),
  removeGlobalSkill: (name: string) => request<{ ok: boolean }>(`/plugins/skills-manager/skills/${name}`, { method: 'DELETE' }),
  listTaskSkills: (taskId: string) =>
    request<{ global: InstalledSkill[]; task: InstalledSkill[] }>(`/plugins/skills-manager/tasks/${taskId}/skills`),
  installTaskSkill: (taskId: string, source: string, skillNames?: string[]) =>
    request<SkillInstallResult>(`/plugins/skills-manager/tasks/${taskId}/skills`, {
      method: 'POST',
      body: JSON.stringify({ source, skillNames }),
    }),
  removeTaskSkill: (taskId: string, name: string) =>
    request<{ ok: boolean }>(`/plugins/skills-manager/tasks/${taskId}/skills/${name}`, { method: 'DELETE' }),

  listApprovals: (taskId: string, all = true) =>
    request<PendingApproval[]>(`/tasks/${taskId}/approvals${all ? '?all=1' : ''}`),
  listSessionApprovals: (sessionId: string) =>
    request<PendingApproval[]>(`/sessions/${sessionId}/approvals`),

  // Legacy (kept for backward compat during transition)
  stopTask: (id: string) => request<{ message: string; sessionId: string }>(`/tasks/${id}/stop`, { method: 'POST' }),
};

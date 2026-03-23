/**
 * Database facade — re-exports all domain modules.
 *
 * Previously backed by on-disk SQLite (agemon.db). Now all data lives in:
 *   - Per-session JSON/JSONL files (~/.agemon/sessions/{id}/)
 *   - Per-task JSON files (~/.agemon/plugins/tasks/data/tasks/)
 *   - Global JSON config files (~/.agemon/settings.json, approval-rules.json, mcp-servers.json)
 *   - In-memory SQLite projections (session-store, task-store)
 *
 * The `db` export preserves the same call-site API so routes/acp code is unchanged.
 */
import { slugify } from '../lib/slugify.ts';
import { queryTaskIds } from '../lib/task-store.ts';

// ─── ID Generation ─────────────────────────────────────────────────────────

export function generateTaskId(title: string): string {
  const base = slugify(title);
  const existing = queryTaskIds(base);

  if (existing.length === 0) return base;

  let maxSuffix = 1;
  for (const row of existing) {
    if (row.id === base) continue;
    const suffix = row.id.slice(base.length + 1);
    const num = parseInt(suffix, 10);
    if (!isNaN(num) && num >= maxSuffix) maxSuffix = num;
  }

  return `${base}-${maxSuffix + 1}`;
}

// ─── Re-export Helpers ───────────────────────────────────────────────────────

export { parseRepoName } from './helpers.ts';

// ─── Re-export Domain Modules ─────────────────────────────────────────────────

import * as tasks from './tasks.ts';
import * as repos from './repos.ts';
import * as sessions from './sessions.ts';
import * as events from './events.ts';
import * as inputs from '../lib/input-store.ts';
import * as approvals from '../lib/approval-store.ts';
import * as approvalRules from '../lib/approval-rules-store.ts';
import * as mcpServers from '../lib/mcp-server-store.ts';
import * as settings from './settings.ts';

export const db = {
  // Tasks
  listTasks: tasks.listTasks,
  getTask: tasks.getTask,
  createTask: tasks.createTask,
  updateTask: tasks.updateTask,
  deleteTask: tasks.deleteTask,
  listTasksByProject: tasks.listTasksByProject,

  // Repos
  listRepos: repos.listRepos,
  upsertRepo: repos.upsertRepo,
  getTaskRepos: repos.getTaskRepos,
  setTaskRepos: repos.setTaskRepos,
  _buildRepoMap: repos._buildRepoMap,

  // Sessions
  getSession: sessions.getSession,
  listSessions: sessions.listSessions,
  listSessionsByState: sessions.listSessionsByState,
  insertSession: sessions.insertSession,
  updateSessionState: sessions.updateSessionState,
  updateSessionName: sessions.updateSessionName,
  updateSessionLastMessage: sessions.updateSessionLastMessage,
  updateSessionArchived: sessions.updateSessionArchived,
  updateSessionUsage: sessions.updateSessionUsage,
  updateSessionConfigOptions: sessions.updateSessionConfigOptions,
  updateSessionAvailableCommands: sessions.updateSessionAvailableCommands,
  getSessionConfigOptions: sessions.getSessionConfigOptions,
  getSessionAvailableCommands: sessions.getSessionAvailableCommands,
  listActiveSessions: sessions.listActiveSessions,
  listAllSessions: sessions.listAllSessions,

  // Events / Chat History
  getLastAgentMessage: events.getLastAgentMessage,
  listChatHistoryBySession: events.listChatHistoryBySession,

  // Inputs
  listPendingInputs: inputs.listPendingInputs,
  listAllPendingInputs: inputs.listAllPendingInputs,
  insertAwaitingInput: inputs.insertAwaitingInput,
  answerInput: inputs.answerInput,

  // Approvals
  insertPendingApproval: approvals.insertPendingApproval,
  resolvePendingApproval: approvals.resolvePendingApproval,
  getPendingApproval: approvals.getPendingApproval,
  listPendingApprovals: approvals.listPendingApprovals,
  listPendingApprovalsBySession: approvals.listPendingApprovalsBySession,
  listAllPendingApprovals: approvals.listAllPendingApprovals,
  listAllApprovals: approvals.listAllApprovals,
  insertApprovalRule: approvalRules.insertApprovalRule,
  findApprovalRule: approvalRules.findApprovalRule,

  // MCP Servers
  addMcpServer: mcpServers.addMcpServer,
  removeMcpServer: mcpServers.removeMcpServer,
  getMcpServer: mcpServers.getMcpServer,
  listGlobalMcpServers: mcpServers.listGlobalMcpServers,
  listTaskMcpServers: mcpServers.listTaskMcpServers,
  getMergedMcpServers: mcpServers.getMergedMcpServers,

  // Settings
  getSetting: settings.getSetting,
  setSetting: settings.setSetting,
  getAllSettings: settings.getAllSettings,
};

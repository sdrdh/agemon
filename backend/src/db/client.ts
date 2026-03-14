import { Database } from 'bun:sqlite';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { slugify } from '../lib/slugify.ts';

// ─── Database Connection ──────────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(homedir(), '.agemon', 'agemon.db');

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.run('PRAGMA journal_mode = WAL');
    _db.run('PRAGMA foreign_keys = ON');
  }
  return _db;
}

export function resetDb(): void {
  _db = null;
}

// ─── ID Generation ───────────────────────────────────────────────────────────

export function generateTaskId(title: string): string {
  const base = slugify(title);
  const database = getDb();

  const existing = database.query<{ id: string }, [string, string]>(
    "SELECT id FROM tasks WHERE id = ? OR id LIKE ? || '-%'"
  ).all(base, base);

  if (existing.length === 0) return base;

  // Find the highest numeric suffix among collisions
  let maxSuffix = 1;
  for (const row of existing) {
    if (row.id === base) continue;
    const suffix = row.id.slice(base.length + 1);
    const num = parseInt(suffix, 10);
    if (!isNaN(num) && num >= maxSuffix) maxSuffix = num;
  }

  return `${base}-${maxSuffix + 1}`;
}

// ─── Re-export Migrations ─────────────────────────────────────────────────────

export { runMigrations, SCHEMA_VERSION } from './migrations.ts';

// ─── Re-export Helpers ────────────────────────────────────────────────────────

export { parseRepoName } from './helpers.ts';

// ─── Re-export Domain Modules ─────────────────────────────────────────────────

import * as tasks from './tasks.ts';
import * as repos from './repos.ts';
import * as sessions from './sessions.ts';
import * as events from './events.ts';
import * as inputs from './inputs.ts';
import * as diffs from './diffs.ts';
import * as approvals from './approvals.ts';
import * as mcpServers from './mcp-servers.ts';
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
  updateSessionArchived: sessions.updateSessionArchived,
  updateSessionUsage: sessions.updateSessionUsage,
  updateSessionConfigOptions: sessions.updateSessionConfigOptions,
  updateSessionAvailableCommands: sessions.updateSessionAvailableCommands,
  getSessionConfigOptions: sessions.getSessionConfigOptions,
  getSessionAvailableCommands: sessions.getSessionAvailableCommands,
  listAllSessions: sessions.listAllSessions,

  // Events
  listEvents: events.listEvents,
  insertEvent: events.insertEvent,
  listChatHistory: events.listChatHistory,
  listChatHistoryBySession: events.listChatHistoryBySession,

  // Inputs
  listPendingInputs: inputs.listPendingInputs,
  insertAwaitingInput: inputs.insertAwaitingInput,
  answerInput: inputs.answerInput,

  // Diffs
  getDiff: diffs.getDiff,
  getPendingDiff: diffs.getPendingDiff,
  insertDiff: diffs.insertDiff,
  updateDiffStatus: diffs.updateDiffStatus,

  // Approvals
  insertPendingApproval: approvals.insertPendingApproval,
  resolvePendingApproval: approvals.resolvePendingApproval,
  getPendingApproval: approvals.getPendingApproval,
  listPendingApprovals: approvals.listPendingApprovals,
  listPendingApprovalsBySession: approvals.listPendingApprovalsBySession,
  listAllApprovals: approvals.listAllApprovals,
  insertApprovalRule: approvals.insertApprovalRule,
  findApprovalRule: approvals.findApprovalRule,

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

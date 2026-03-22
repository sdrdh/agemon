import type { Task, TaskWorkspace, AgentSession, AgentSessionState, AgentType, PendingApproval, ApprovalDecision, McpServerConfig, McpServerEntry } from '@agemon/shared';
import { AGENT_TYPES as AGENT_TYPES_ARRAY } from '@agemon/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

export const TASK_STATUSES = new Set<Task['status']>(['todo', 'working', 'awaiting_input', 'done']);
export const AGENT_TYPES_SET = new Set<AgentType>(AGENT_TYPES_ARRAY);
export const SESSION_STATES = new Set<AgentSessionState>([
  'starting', 'ready', 'running', 'stopped', 'crashed', 'interrupted',
]);
export const TERMINAL_STATES = new Set<AgentSessionState>(['stopped', 'crashed', 'interrupted']);

// ─── Repo Name Parsing ────────────────────────────────────────────────────────

/**
 * Extract a display name from a repo URL.
 * - SSH:   git@github.com:acme/web.git → acme/web
 * - HTTPS: https://github.com/org/repo  → org/repo
 * - Fallback: return the URL as-is
 */
export function parseRepoName(url: string): string {
  // SSH format: git@host:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS format: https://host/owner/repo(.git)?
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return url;
}

// ─── Row Parsers ──────────────────────────────────────────────────────────────

export interface RawTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  agent: string;
  archived: number;
  workspace_json?: string | null;
  created_at: string;
}

export function parseTask(row: RawTask): Omit<Task, 'repos'> {
  const status = TASK_STATUSES.has(row.status as Task['status'])
    ? (row.status as Task['status'])
    : (() => { throw new Error(`[db] unexpected task status: ${row.status}`); })();
  const agent = AGENT_TYPES_SET.has(row.agent as AgentType)
    ? (row.agent as AgentType)
    : (() => { throw new Error(`[db] unexpected agent type: ${row.agent}`); })();

  let workspace: TaskWorkspace | undefined;
  if (row.workspace_json) {
    try { workspace = JSON.parse(row.workspace_json); } catch { /* ignore malformed */ }
  }

  return { id: row.id, title: row.title, description: row.description, status, agent, archived: !!row.archived, workspace, created_at: row.created_at };
}

export function parseSession(row: AgentSession): AgentSession {
  if (!SESSION_STATES.has(row.state)) {
    throw new Error(`[db] unexpected session state: ${row.state}`);
  }
  if (!AGENT_TYPES_SET.has(row.agent_type)) {
    throw new Error(`[db] unexpected agent type: ${row.agent_type}`);
  }
  // SQLite returns 0/1 for boolean columns
  const session: AgentSession = { ...row, archived: !!(row as any).archived };

  // Derive task_id from meta_json for backward compatibility
  const metaJson = (row as any).meta_json as string | undefined;
  if (metaJson) {
    session.meta_json = metaJson;
    try {
      const meta = JSON.parse(metaJson);
      session.task_id = meta.task_id ?? null;
    } catch {
      session.task_id = null;
    }
  } else {
    session.task_id = session.task_id ?? null;
  }

  const usageJson = (row as any).usage_json;
  if (usageJson) {
    try { session.usage = JSON.parse(usageJson); } catch { /* ignore malformed */ }
  }
  return session;
}

// ─── MCP Server Mapping ───────────────────────────────────────────────────────

export interface RawMcpServer {
  id: string;
  name: string;
  task_id: string | null;
  config: string;
  created_at: string;
}

export function mapMcpServer(row: RawMcpServer): McpServerEntry {
  let config: McpServerConfig;
  try {
    config = JSON.parse(row.config);
  } catch {
    console.error(`[db] malformed MCP server config for id=${row.id}, skipping`);
    throw new Error(`Invalid MCP server config for id=${row.id}`);
  }
  return {
    id: row.id,
    name: row.name,
    scope: row.task_id ? 'task' : 'global',
    taskId: row.task_id,
    config,
    createdAt: row.created_at,
  };
}

// ─── Approval Mapping ─────────────────────────────────────────────────────────

export interface RawApproval {
  id: string;
  task_id: string | null;
  session_id: string;
  tool_name: string;
  tool_title: string;
  context: string;
  options: string;
  status: string;
  decision: string | null;
  created_at: string;
}

export const APPROVAL_COLUMNS = 'id, task_id, session_id, tool_name, tool_title, context, options, status, decision, created_at';

export function mapApproval(row: RawApproval): PendingApproval {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    toolTitle: row.tool_title,
    context: JSON.parse(row.context),
    options: JSON.parse(row.options),
    status: row.status as 'pending' | 'resolved',
    decision: (row.decision as ApprovalDecision | null) ?? undefined,
    createdAt: row.created_at,
  };
}

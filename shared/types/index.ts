// ─── Core Domain Types ────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'working' | 'awaiting_input' | 'done';

export const AGENT_TYPES = ['claude-code', 'opencode', 'gemini', 'pi', 'codex'] as const;
export type AgentType = typeof AGENT_TYPES[number];

export type AgentSessionState = 'starting' | 'ready' | 'running' | 'stopped' | 'crashed' | 'interrupted';

export interface Repo {
  id: number;
  url: string;
  name: string;
  created_at: string;
}

export interface TaskWorkspace {
  provider: string;  // 'cwd' | 'git-worktree' | plugin-registered ID
  config: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  repos: Repo[];
  agent: AgentType;
  archived: boolean;
  workspace?: TaskWorkspace;
  created_at: string; // ISO 8601
}

export interface AgentSession {
  id: string;
  task_id: string | null;
  meta_json?: string;              // Raw JSON for plugin access
  agent_type: AgentType;
  name: string | null;                // Human-readable label from first prompt
  external_session_id: string | null; // Provider session ID for --resume
  pid: number | null;                 // OS process ID; null if not running
  state: AgentSessionState;
  archived: boolean;
  started_at: string;   // ISO 8601
  ended_at: string | null;
  exit_code: number | null;
  usage?: SessionUsage; // Latest token usage snapshot; undefined until first usage_update
  last_message?: string | null; // Short preview of last user/agent message
}

export interface ACPEvent {
  id: string;
  task_id: string;
  session_id: string;
  type: 'thought' | 'action' | 'await_input' | 'result' | 'prompt';
  content: string;
  created_at: string;
}

export interface AwaitingInput {
  id: string;
  task_id: string | null;
  session_id: string;
  question: string;
  status: 'pending' | 'answered';
  response: string | null;
  created_at: string;
}

// ─── Tool Approval Types ──────────────────────────────────────────────────
export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

export interface ApprovalOption {
  kind: string;      // e.g. 'allow_once', 'allow_always', 'deny'
  optionId: string;  // ACP option ID to send back
  label: string;     // Human-readable label
}

export interface PendingApproval {
  id: string;
  taskId: string | null;
  sessionId: string;
  toolName: string;          // e.g. "Edit", "Bash", "Write"
  toolTitle: string;         // Full title from ACP (e.g. "Edit frontend/src/App.tsx")
  context: Record<string, string>; // Key-value metadata (cwd, args, path, etc.)
  options: ApprovalOption[];
  status: 'pending' | 'resolved';
  decision?: ApprovalDecision;
  createdAt: string;
}

export interface ApprovalRule {
  id: string;
  taskId: string | null;     // null = global rule
  sessionId: string | null;
  toolName: string;           // Tool name pattern to match
  createdAt: string;
}

export interface Diff {
  id: string;
  task_id: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

// ─── Tool Call Event Types ───────────────────────────────────────────────────

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallDisplay {
  type: string;
  file?: { filePath: string; content: string };
  [key: string]: unknown;
}

export interface ToolCallEvent {
  toolCallId: string;
  kind: string;           // Tool type: "Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebSearch", "Agent", etc.
  title: string;          // Display title from ACP
  status: ToolCallStatus;
  args: Record<string, string>; // Tool-specific params (command, filePath, pattern, etc.)
  startedAt: string;      // ISO timestamp when tool call began
}

export interface ToolCallUpdateEvent {
  toolCallId: string;
  status: ToolCallStatus;
  isUpdate: true;                     // Discriminator to distinguish from ToolCallEvent
  title?: string;                     // Updated display title (e.g. "Read /etc/hostname")
  kind?: string;                      // Tool kind if changed
  args?: Record<string, string>;      // Tool-specific params from rawInput
  output?: string;                    // Tool output text (truncated)
  error?: string;                     // Error message if tool failed
  display?: ToolCallDisplay;          // Structured UI data (agent-specific)
  completedAt?: string;               // ISO timestamp when tool completed
}

// ─── Session Usage ───────────────────────────────────────────────────────────

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  /** Max context window size in tokens (agent-reported or default) */
  contextWindow: number;
  /** Cost in USD (if reported by agent, e.g. OpenCode) */
  cost?: number;
}

// ─── Agent Commands (Slash Commands) ────────────────────────────────────────

export interface AgentCommand {
  name: string;
  description?: string;
  input?: { hint: string };
}

// ─── Session Config Options ─────────────────────────────────────────────────

export interface SessionConfigOption {
  id: string;           // e.g. 'model', 'mode'
  type: 'select';       // Only select supported for now
  label: string;        // Human-readable label
  value: string;        // Current value
  options: { value: string; label: string }[];
}

export interface ChatMessage {
  id: string;
  role: 'agent' | 'user' | 'system';
  content: string;
  eventType: 'thought' | 'action' | 'input_request' | 'input_response' | 'prompt' | 'status' | 'approval_request' | 'approval_resolved';
  timestamp: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

// ─── Version & Settings Types ───────────────────────────────────────────────

export const RELEASE_CHANNELS = ['stable', 'pre-release', 'nightly', 'branch'] as const;
export type ReleaseChannel = typeof RELEASE_CHANNELS[number];

export interface VersionInfo {
  current: string;
  running_under_systemd: boolean;
}

export interface VersionCheckResult {
  current: string;
  latest: string;
  latest_tag: string;
  has_update: boolean;
  should_notify: boolean;
  published_at: string;
  release_url: string;
  checked_at: string;
  channel: ReleaseChannel;
  error?: string;
}

export interface UpdateResult {
  ok: boolean;
  method: 'git' | 'binary';
  from_version: string;
  to_version: string;
  message: string;
}

export interface RestartResult {
  ok: boolean;
  reason?: 'not_supervised' | 'shutting_down';
  message: string;
}

export interface SettingEntry {
  key: string;
  value: string;
  updated_at: string;
}

// ─── WebSocket Event Types ────────────────────────────────────────────────────

interface ServerEventBase {
  seq: number;
  epoch: string;
}

/** Distributes Omit across union members (built-in Omit collapses them). */
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export type ServerEventPayload = DistributiveOmit<ServerEvent, 'seq' | 'epoch'>;

export type ServerEvent =
  | (ServerEventBase & { type: 'task_updated'; task: Task })
  | (ServerEventBase & { type: 'agent_thought'; taskId: string | null; sessionId: string; content: string; eventType: 'thought' | 'action'; messageId?: string })
  | (ServerEventBase & { type: 'awaiting_input'; taskId: string | null; sessionId: string; question: string; inputId: string })
  | (ServerEventBase & { type: 'terminal_output'; sessionId: string; data: string })
  | (ServerEventBase & { type: 'session_started'; taskId: string | null; session: AgentSession })
  | (ServerEventBase & { type: 'session_ready'; taskId: string | null; session: AgentSession })
  | (ServerEventBase & { type: 'session_state_changed'; sessionId: string; taskId: string | null; state: AgentSessionState })
  | (ServerEventBase & { type: 'approval_requested'; approval: PendingApproval })
  | (ServerEventBase & { type: 'approval_resolved'; approvalId: string; decision: ApprovalDecision })
  | (ServerEventBase & { type: 'config_options_updated'; sessionId: string; taskId: string | null; configOptions: SessionConfigOption[] })
  | (ServerEventBase & { type: 'available_commands'; sessionId: string; taskId: string | null; commands: AgentCommand[] })
  | (ServerEventBase & { type: 'turn_cancelled'; sessionId: string; taskId: string | null })
  | (ServerEventBase & { type: 'turn_completed'; sessionId: string; taskId: string | null })
  | (ServerEventBase & { type: 'session_usage_update'; sessionId: string; taskId: string | null; usage: SessionUsage })
  | (ServerEventBase & { type: 'update_available'; version: string; should_notify: boolean })
  | (ServerEventBase & { type: 'plugins_changed'; pluginIds: string[] })
  | (ServerEventBase & { type: 'server_restarting' })
  | (ServerEventBase & { type: 'full_sync_required' });

export type ClientEvent =
  | { type: 'send_input'; sessionId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string }
  | { type: 'send_message'; sessionId: string; content: string }
  | { type: 'approval_response'; approvalId: string; decision: ApprovalDecision }
  | { type: 'set_config_option'; sessionId: string; configId: string; value: string }
  | { type: 'cancel_turn'; sessionId: string }
  | { type: 'resume'; lastSeq: number };

// ─── Dashboard Types ────────────────────────────────────────────────────────

export interface DashboardSessionBase {
  session: AgentSession;
  task: { id: string; title: string; description: string | null };
  lastAgentMessage: string | null;
}

export interface DashboardBlockedSession extends DashboardSessionBase {
  pendingInputs: AwaitingInput[];
  pendingApprovals: PendingApproval[];
}

export interface DashboardIdleSession extends DashboardSessionBase {}

export interface DashboardActiveResponse {
  blocked: DashboardBlockedSession[];
  idle: DashboardIdleSession[];
}

// ─── API Request/Response Shapes ─────────────────────────────────────────────

export interface CreateTaskBody {
  title: string;
  description?: string;
  repos?: string[];        // SSH URLs; optional, default []
  agent?: AgentType;       // default claude-code
  workspace?: TaskWorkspace;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  repos?: string[];        // SSH URLs; replaces full set
  agent?: AgentType;
  archived?: boolean;
  workspace?: TaskWorkspace;
}

export interface CreateSessionBody {
  agentType?: AgentType;
}

export interface TasksByProject {
  projects: Record<string, Task[]>;  // keyed by repo name (e.g. "acme/web")
  ungrouped: Task[];
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ─── MCP Server Configuration ───────────────────────────────────────────────

export interface McpServerStdio {
  name: string;
  command: string;
  args?: string[];
  env?: { name: string; value: string }[];
}

export interface McpServerHttp {
  type: 'http';
  name: string;
  url: string;
  headers?: { name: string; value: string }[];
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

export interface McpServerEntry {
  id: string;
  name: string;
  scope: 'global' | 'task';
  taskId: string | null;
  config: McpServerConfig;
  createdAt: string;
}

export interface CreateMcpServerBody {
  name: string;
  config: McpServerConfig;
}

export interface TestMcpServerBody {
  config: McpServerConfig;
}

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface TestMcpServerResult {
  status: 'connected' | 'error';
  message: string;
  latencyMs: number;
  tools?: McpToolInfo[];
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  scope: 'global' | 'task' | 'repo';
}

export interface SkillPreview {
  name: string;
  description: string;
}

export interface SkillPreviewResult {
  ok: boolean;
  skills: SkillPreview[];
  error?: string;
}

export interface SkillInstallResult {
  ok: boolean;
  installed?: string[];
  error?: string;
}

// ─── Shared Validation ──────────────────────────────────────────────────────

/** Matches SSH repo URLs: git@host:org/repo(.git)? */
export const SSH_REPO_REGEX = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/;

// ─── Plugin Types ────────────────────────────────────────────────────────────

export type { PluginManifest, CustomRendererManifest, InputExtensionManifest } from './plugin.ts';

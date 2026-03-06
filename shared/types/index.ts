// ─── Core Domain Types ────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'working' | 'awaiting_input' | 'done';

export const AGENT_TYPES = ['claude-code', 'opencode', 'aider', 'gemini'] as const;
export type AgentType = typeof AGENT_TYPES[number];

export type AgentSessionState = 'starting' | 'ready' | 'running' | 'stopped' | 'crashed' | 'interrupted';

export interface Repo {
  id: number;
  url: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  repos: Repo[];
  agent: AgentType;
  created_at: string; // ISO 8601
}

export interface AgentSession {
  id: string;
  task_id: string;
  agent_type: AgentType;
  name: string | null;                // Human-readable label from first prompt
  external_session_id: string | null; // Provider session ID for --resume
  pid: number | null;                 // OS process ID; null if not running
  state: AgentSessionState;
  started_at: string;   // ISO 8601
  ended_at: string | null;
  exit_code: number | null;
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
  task_id: string;
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
  taskId: string;
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

// ─── WebSocket Event Types ────────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'task_updated'; task: Task }
  | { type: 'agent_thought'; taskId: string; sessionId: string; content: string; eventType: 'thought' | 'action'; messageId?: string }
  | { type: 'awaiting_input'; taskId: string; sessionId: string; question: string; inputId: string }
  | { type: 'terminal_output'; sessionId: string; data: string }
  | { type: 'session_started'; taskId: string; session: AgentSession }
  | { type: 'session_ready'; taskId: string; session: AgentSession }
  | { type: 'session_state_changed'; sessionId: string; taskId: string; state: AgentSessionState }
  | { type: 'approval_requested'; approval: PendingApproval }
  | { type: 'approval_resolved'; approvalId: string; decision: ApprovalDecision }
  | { type: 'config_options_updated'; sessionId: string; taskId: string; configOptions: SessionConfigOption[] }
  | { type: 'available_commands'; sessionId: string; taskId: string; commands: AgentCommand[] };

export type ClientEvent =
  | { type: 'send_input'; taskId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string }
  | { type: 'send_message'; sessionId: string; content: string }
  | { type: 'approval_response'; approvalId: string; decision: ApprovalDecision }
  | { type: 'set_config_option'; sessionId: string; configId: string; value: string };

// ─── API Request/Response Shapes ─────────────────────────────────────────────

export interface CreateTaskBody {
  title: string;
  description?: string;
  repos?: string[];  // SSH URLs; optional, default []
  agent?: AgentType; // default claude-code
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  repos?: string[];  // SSH URLs; replaces full set
  agent?: AgentType;
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

export interface TestMcpServerResult {
  status: 'connected' | 'error';
  message: string;
  latencyMs: number;
}

// ─── Shared Validation ──────────────────────────────────────────────────────

/** Matches SSH repo URLs: git@host:org/repo(.git)? */
export const SSH_REPO_REGEX = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/;

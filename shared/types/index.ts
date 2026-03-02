// ─── Core Domain Types ────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'working' | 'awaiting_input' | 'done';

export const AGENT_TYPES = ['claude-code', 'opencode', 'aider', 'gemini'] as const;
export type AgentType = typeof AGENT_TYPES[number];

export type AgentSessionState = 'starting' | 'running' | 'stopped' | 'crashed' | 'interrupted';

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

export interface Diff {
  id: string;
  task_id: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'agent' | 'user' | 'system';
  content: string;
  eventType: 'thought' | 'action' | 'input_request' | 'input_response' | 'prompt' | 'status';
  timestamp: string;
}

// ─── WebSocket Event Types ────────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'task_updated'; task: Task }
  | { type: 'agent_thought'; taskId: string; content: string; eventType: 'thought' | 'action'; messageId?: string }
  | { type: 'awaiting_input'; taskId: string; question: string; inputId: string }
  | { type: 'terminal_output'; sessionId: string; data: string }
  | { type: 'session_started'; taskId: string; session: AgentSession }
  | { type: 'session_state_changed'; sessionId: string; taskId: string; state: AgentSessionState };

export type ClientEvent =
  | { type: 'send_input'; taskId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string }
  | { type: 'send_message'; taskId: string; content: string };

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
  repos?: string[];  // SSH URLs; replaces full set
  agent?: AgentType;
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

// ─── Shared Validation ──────────────────────────────────────────────────────

/** Matches SSH repo URLs: git@host:org/repo(.git)? */
export const SSH_REPO_REGEX = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/;

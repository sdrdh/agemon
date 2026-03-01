// ─── Core Domain Types ────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'working' | 'awaiting_input' | 'done';

export const AGENT_TYPES = ['claude-code', 'opencode', 'aider', 'gemini'] as const;
export type AgentType = typeof AGENT_TYPES[number];

export type AgentSessionState = 'starting' | 'running' | 'stopped' | 'crashed' | 'interrupted';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  repos: string[]; // JSON array of repo URLs/paths
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
  type: 'thought' | 'action' | 'await_input' | 'result';
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

// ─── WebSocket Event Types ────────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'task_updated'; task: Task }
  | { type: 'agent_thought'; taskId: string; content: string }
  | { type: 'awaiting_input'; taskId: string; question: string; inputId: string }
  | { type: 'terminal_output'; sessionId: string; data: string }
  | { type: 'session_started'; taskId: string; session: AgentSession }
  | { type: 'session_state_changed'; sessionId: string; state: AgentSessionState };

export type ClientEvent =
  | { type: 'send_input'; taskId: string; inputId: string; response: string }
  | { type: 'terminal_input'; sessionId: string; data: string };

// ─── API Request/Response Shapes ─────────────────────────────────────────────

export interface CreateTaskBody {
  title: string;
  description?: string;
  repos: string[];
  agent: AgentType;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  agent?: AgentType;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

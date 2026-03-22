import type { JsonRpcTransport } from '../jsonrpc.ts';
import type { AgentType, SessionConfigOption, AgentCommand } from '@agemon/shared';

export interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  transport: JsonRpcTransport;
  sessionId: string;
  taskId: string | null;
  agentType: AgentType;
  acpSessionId: string | null;
  turnInFlight: boolean;
  /** Number of prompts sent to this session. Used to detect the first prompt. */
  promptsSent: number;
  /** Stable ID for the current streaming message (accumulates chunks). */
  currentMessageId: string | null;
  currentMessageText: string;
  currentMessageType: 'thought' | 'action';
  /** Config options advertised by the agent (model, mode, etc.) */
  configOptions: SessionConfigOption[];
  /** Available slash commands advertised by the agent */
  availableCommands: AgentCommand[];
}

export const sessions = new Map<string, RunningSession>();
export const userStopped = new Set<string>(); // Track sessions stopped by user

export const KILL_TIMEOUT_MS = 5_000;
export const SHUTDOWN_REQUEST_TIMEOUT_MS = 3_000;

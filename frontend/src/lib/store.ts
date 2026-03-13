import { create } from 'zustand';
import type { AgentCommand, ChatMessage, PendingApproval, ApprovalDecision, SessionConfigOption, SessionUsage, ToolCallStatus, ToolCallDisplay } from '@agemon/shared';

interface PendingInput {
  inputId: string;
  taskId: string;
  sessionId: string;
  question: string;
  receivedAt: number;
}

export interface ToolCall {
  toolCallId: string;
  kind: string;
  title: string;
  args: Record<string, string>;
  status: ToolCallStatus;
  output?: string;
  error?: string;
  display?: ToolCallDisplay;
  startedAt: string;
  completedAt?: string;
}

interface WsState {
  connected: boolean;
  /** Chat messages keyed by sessionId */
  chatMessages: Record<string, ChatMessage[]>;
  pendingInputs: PendingInput[];
  /** Pending tool call approvals */
  pendingApprovals: PendingApproval[];
  /** Agent activity indicator keyed by sessionId */
  agentActivity: Record<string, string | null>;
  /** Sessions with unread activity (not currently viewed) */
  unreadSessions: Record<string, boolean>;
  /** Config options advertised by agents, keyed by sessionId */
  configOptions: Record<string, SessionConfigOption[]>;
  /** Available slash commands advertised by agents, keyed by sessionId */
  availableCommands: Record<string, AgentCommand[]>;
  /** Sessions with a turn currently in flight */
  turnsInFlight: Record<string, boolean>;
  /** Latest usage snapshot keyed by sessionId */
  sessionUsage: Record<string, SessionUsage>;
  /** Tool calls keyed by sessionId */
  toolCalls: Record<string, ToolCall[]>;
  setConnected: (connected: boolean) => void;
  appendChatMessage: (sessionId: string, msg: ChatMessage) => void;
  setChatMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  clearChatMessages: (sessionId: string) => void;
  addPendingInput: (input: PendingInput) => void;
  removePendingInput: (inputId: string) => void;
  addPendingApproval: (approval: PendingApproval) => void;
  resolvePendingApproval: (approvalId: string, decision: ApprovalDecision) => void;
  mergePendingApprovals: (taskId: string, approvals: PendingApproval[]) => void;
  setAgentActivity: (sessionId: string, activity: string | null) => void;
  markUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;
  setConfigOptions: (sessionId: string, options: SessionConfigOption[]) => void;
  setAvailableCommands: (sessionId: string, commands: AgentCommand[]) => void;
  setTurnInFlight: (sessionId: string, inFlight: boolean) => void;
  setSessionUsage: (sessionId: string, usage: SessionUsage) => void;
  upsertToolCall: (sessionId: string, toolCallId: string, patch: Partial<ToolCall>) => void;
  clearToolCalls: (sessionId: string) => void;
}

const MAX_MESSAGES_PER_SESSION = 500;
const MAX_APPROVALS = 200;
const MAX_TOOL_CALLS_PER_SESSION = 200;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  chatMessages: {},
  pendingInputs: [],
  pendingApprovals: [],
  agentActivity: {},
  unreadSessions: {},
  configOptions: {},
  availableCommands: {},
  turnsInFlight: {},
  sessionUsage: {},
  toolCalls: {},

  setConnected: (connected) => set({ connected }),

  appendChatMessage: (sessionId, msg) =>
    set((state) => {
      const existing = state.chatMessages[sessionId] ?? [];
      // If message with same ID exists, append content (streaming chunk accumulation)
      const idx = existing.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...updated[idx], content: updated[idx].content + msg.content };
        return { chatMessages: { ...state.chatMessages, [sessionId]: updated } };
      }
      const updated = [...existing, msg];
      const trimmed = updated.length > MAX_MESSAGES_PER_SESSION
        ? updated.slice(updated.length - MAX_MESSAGES_PER_SESSION)
        : updated;
      return { chatMessages: { ...state.chatMessages, [sessionId]: trimmed } };
    }),

  setChatMessages: (sessionId, msgs) =>
    set((state) => ({
      chatMessages: { ...state.chatMessages, [sessionId]: msgs },
    })),

  clearChatMessages: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.chatMessages;
      return { chatMessages: rest };
    }),

  addPendingInput: (input) =>
    set((state) => ({
      pendingInputs: [...state.pendingInputs, input],
    })),

  removePendingInput: (inputId) =>
    set((state) => ({
      pendingInputs: state.pendingInputs.filter((p) => p.inputId !== inputId),
    })),

  addPendingApproval: (approval) =>
    set((state) => ({
      pendingApprovals: [...state.pendingApprovals, approval],
    })),

  resolvePendingApproval: (approvalId, decision) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.map((a) =>
        a.id === approvalId ? { ...a, status: 'resolved' as const, decision } : a
      ),
    })),

  mergePendingApprovals: (taskId, approvals) =>
    set((state) => {
      const serverIds = new Set(approvals.map((a) => a.id));
      // Keep entries from other tasks, plus any WebSocket-delivered entries for this
      // task that the server response doesn't yet include (race window).
      const kept = state.pendingApprovals.filter(
        (a) => a.taskId !== taskId || !serverIds.has(a.id),
      );
      let merged = [...kept, ...approvals];
      // Cap: if over limit, drop oldest resolved entries first
      if (merged.length > MAX_APPROVALS) {
        const pending = merged.filter((a) => a.status === 'pending');
        const resolved = merged.filter((a) => a.status !== 'pending')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        merged = [...pending, ...resolved.slice(resolved.length - (MAX_APPROVALS - pending.length))];
      }
      return { pendingApprovals: merged };
    }),

  setAgentActivity: (sessionId, activity) =>
    set((state) => ({
      agentActivity: { ...state.agentActivity, [sessionId]: activity },
    })),

  markUnread: (sessionId) =>
    set((state) => ({
      unreadSessions: { ...state.unreadSessions, [sessionId]: true },
    })),

  clearUnread: (sessionId) =>
    set((state) => {
      if (!state.unreadSessions[sessionId]) return state;
      const { [sessionId]: _, ...rest } = state.unreadSessions;
      return { unreadSessions: rest };
    }),

  setConfigOptions: (sessionId, options) =>
    set((state) => ({
      configOptions: { ...state.configOptions, [sessionId]: options },
    })),

  setAvailableCommands: (sessionId, commands) =>
    set((state) => ({
      availableCommands: { ...state.availableCommands, [sessionId]: commands },
    })),

  setTurnInFlight: (sessionId, inFlight) =>
    set((state) => {
      const turnsInFlight = { ...state.turnsInFlight };
      if (inFlight) {
        turnsInFlight[sessionId] = true;
      } else {
        delete turnsInFlight[sessionId];
      }
      return { turnsInFlight };
    }),

  setSessionUsage: (sessionId, usage) =>
    set((state) => ({
      sessionUsage: { ...state.sessionUsage, [sessionId]: usage },
    })),

  upsertToolCall: (sessionId, toolCallId, patch) =>
    set((state) => {
      const existing = state.toolCalls[sessionId] ?? [];
      const idx = existing.findIndex((tc) => tc.toolCallId === toolCallId);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...updated[idx], ...patch };
        return { toolCalls: { ...state.toolCalls, [sessionId]: updated } };
      }
      // New entry — requires at least kind, title, args, status, startedAt
      const entry: ToolCall = {
        toolCallId,
        kind: patch.kind ?? 'unknown',
        title: patch.title ?? 'Tool',
        args: patch.args ?? {},
        status: patch.status ?? 'pending',
        startedAt: patch.startedAt ?? new Date().toISOString(),
        ...patch,
      };
      const updated = [...existing, entry];
      const trimmed = updated.length > MAX_TOOL_CALLS_PER_SESSION
        ? updated.slice(updated.length - MAX_TOOL_CALLS_PER_SESSION)
        : updated;
      return { toolCalls: { ...state.toolCalls, [sessionId]: trimmed } };
    }),

  clearToolCalls: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.toolCalls;
      return { toolCalls: rest };
    }),
}));

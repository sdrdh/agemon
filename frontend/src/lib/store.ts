import { create } from 'zustand';
import type { ChatMessage, PendingApproval, ApprovalDecision, SessionConfigOption } from '@agemon/shared';

interface PendingInput {
  inputId: string;
  taskId: string;
  sessionId: string;
  question: string;
  receivedAt: number;
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
}

const MAX_MESSAGES_PER_SESSION = 500;
const MAX_APPROVALS = 200;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  chatMessages: {},
  pendingInputs: [],
  pendingApprovals: [],
  agentActivity: {},
  unreadSessions: {},
  configOptions: {},

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
}));

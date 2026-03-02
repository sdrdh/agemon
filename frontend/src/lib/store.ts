import { create } from 'zustand';
import type { ChatMessage } from '@agemon/shared';

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
  /** Agent activity indicator keyed by sessionId */
  agentActivity: Record<string, string | null>;
  /** Sessions with unread activity (not currently viewed) */
  unreadSessions: Record<string, boolean>;
  setConnected: (connected: boolean) => void;
  appendChatMessage: (sessionId: string, msg: ChatMessage) => void;
  setChatMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  clearChatMessages: (sessionId: string) => void;
  addPendingInput: (input: PendingInput) => void;
  removePendingInput: (inputId: string) => void;
  setAgentActivity: (sessionId: string, activity: string | null) => void;
  markUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;
}

const MAX_MESSAGES_PER_SESSION = 500;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  chatMessages: {},
  pendingInputs: [],
  agentActivity: {},
  unreadSessions: {},

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
}));

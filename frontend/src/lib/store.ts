import { create } from 'zustand';
import type { ChatMessage } from '@agemon/shared';

interface PendingInput {
  inputId: string;
  taskId: string;
  question: string;
  receivedAt: number;
}

interface WsState {
  connected: boolean;
  chatMessages: Record<string, ChatMessage[]>;
  pendingInputs: PendingInput[];
  setConnected: (connected: boolean) => void;
  appendChatMessage: (taskId: string, msg: ChatMessage) => void;
  setChatMessages: (taskId: string, msgs: ChatMessage[]) => void;
  clearChatMessages: (taskId: string) => void;
  addPendingInput: (input: PendingInput) => void;
  removePendingInput: (inputId: string) => void;
}

const MAX_MESSAGES_PER_TASK = 500;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  chatMessages: {},
  pendingInputs: [],

  setConnected: (connected) => set({ connected }),

  appendChatMessage: (taskId, msg) =>
    set((state) => {
      const existing = state.chatMessages[taskId] ?? [];
      // Dedup: skip if msg.id already exists
      if (existing.some((m) => m.id === msg.id)) return state;
      const updated = [...existing, msg];
      const trimmed = updated.length > MAX_MESSAGES_PER_TASK
        ? updated.slice(updated.length - MAX_MESSAGES_PER_TASK)
        : updated;
      return { chatMessages: { ...state.chatMessages, [taskId]: trimmed } };
    }),

  setChatMessages: (taskId, msgs) =>
    set((state) => ({
      chatMessages: { ...state.chatMessages, [taskId]: msgs },
    })),

  clearChatMessages: (taskId) =>
    set((state) => {
      const { [taskId]: _removed, ...rest } = state.chatMessages;
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
}));

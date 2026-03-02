import { create } from 'zustand';

interface PendingInput {
  inputId: string;
  taskId: string;
  question: string;
  receivedAt: number;
}

interface WsState {
  connected: boolean;
  thoughts: Record<string, string[]>;
  pendingInputs: PendingInput[];
  setConnected: (connected: boolean) => void;
  appendThought: (taskId: string, content: string) => void;
  clearThoughts: (taskId: string) => void;
  addPendingInput: (input: PendingInput) => void;
  removePendingInput: (inputId: string) => void;
}

const MAX_THOUGHTS_PER_TASK = 500;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  thoughts: {},
  pendingInputs: [],

  setConnected: (connected) => set({ connected }),

  appendThought: (taskId, content) =>
    set((state) => {
      const existing = state.thoughts[taskId] ?? [];
      const updated = [...existing, content];
      const trimmed = updated.length > MAX_THOUGHTS_PER_TASK
        ? updated.slice(updated.length - MAX_THOUGHTS_PER_TASK)
        : updated;
      return { thoughts: { ...state.thoughts, [taskId]: trimmed } };
    }),

  clearThoughts: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.thoughts;
      void _;
      return { thoughts: rest };
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

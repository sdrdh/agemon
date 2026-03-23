import type { WorkspaceProvider } from './workspace.ts';

const registry = new Map<string, WorkspaceProvider>();

export const workspaceRegistry = {
  register(id: string, provider: WorkspaceProvider): void {
    registry.set(id, provider);
  },
  get(id: string): WorkspaceProvider | undefined {
    return registry.get(id);
  },
  list(): Array<{ id: string; provider: WorkspaceProvider }> {
    return [...registry.entries()].map(([id, provider]) => ({ id, provider }));
  },
};

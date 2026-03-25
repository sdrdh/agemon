/**
 * AgentRegistry — extensible registry for agent providers.
 *
 * Built-in agents (from AGENT_CONFIGS) are registered at server startup.
 * Plugins can register additional AgentProviders via PluginExports.agentProviders.
 */

import { AGENT_CONFIGS } from '../agents.ts';
import type { AgentConfig } from '../agents.ts';

/**
 * AgentProvider — what a plugin registers to support an agent type.
 * Uses the existing AgentConfig shape. The registry wraps it with an id.
 */
export interface AgentProvider {
  id: string;
  config: AgentConfig;
}

class AgentRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
    console.info(`[agent-registry] registered provider: ${provider.id}`);
  }

  get(agentType: string): AgentProvider | undefined {
    return this.providers.get(agentType);
  }

  getAll(): AgentProvider[] {
    return [...this.providers.values()];
  }

  isRegistered(agentType: string): boolean {
    return this.providers.has(agentType);
  }
}

export const agentRegistry = new AgentRegistry();

/** Register all built-in agents from AGENT_CONFIGS at server startup. */
export function registerBuiltinAgents(): void {
  for (const [id, config] of Object.entries(AGENT_CONFIGS)) {
    agentRegistry.register({ id, config });
  }
}

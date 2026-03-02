/**
 * Per-agent spawn configuration.
 *
 * Each supported agent type has a command template, required env vars,
 * and a human-readable label. The buildAgentEnv helper strips sensitive
 * Agemon variables before passing env to subprocesses.
 */

import type { AgentType } from '@agemon/shared';

export interface AgentConfig {
  command: string[];
  passEnvVars: string[];
  label: string;
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  'claude-code': {
    command: ['claude-agent-acp', '--agent', 'claude-code'],
    passEnvVars: [],
    label: 'Claude Code (via claude-agent-acp)',
  },
  'opencode': {
    command: ['opencode', 'acp'],
    passEnvVars: ['OPENCODE_API_KEY'],
    label: 'OpenCode',
  },
  'aider': {
    command: ['aider', '--acp'],
    passEnvVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    label: 'Aider',
  },
  'gemini': {
    command: ['gemini', '--experimental-acp'],
    passEnvVars: ['GOOGLE_API_KEY'],
    label: 'Gemini CLI',
  },
};

/**
 * Build a safe environment for agent subprocesses.
 * Strips AGEMON_KEY and GITHUB_PAT to prevent credential leakage.
 */
export function buildAgentEnv(agentType: AgentType): Record<string, string | undefined> {
  const { AGEMON_KEY: _, GITHUB_PAT: __, ...safeEnv } = process.env;
  const config = AGENT_CONFIGS[agentType];

  // Ensure agent-specific env vars are passed through
  const env: Record<string, string | undefined> = { ...safeEnv };
  for (const key of config.passEnvVars) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}

/**
 * Resolve the agent binary path on the system PATH.
 * Throws a descriptive error if the binary is not found.
 */
export function resolveAgentBinary(agentType: AgentType): string {
  const config = AGENT_CONFIGS[agentType];
  const binary = config.command[0];
  const path = Bun.which(binary);
  if (!path) {
    throw new Error(`${binary} not found on PATH. Agent type: ${agentType} (${config.label})`);
  }
  return path;
}

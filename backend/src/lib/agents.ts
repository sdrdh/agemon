/**
 * Per-agent spawn configuration.
 *
 * Each supported agent type has a command template, required env vars,
 * and a human-readable label. The buildAgentEnv helper strips sensitive
 * Agemon variables before passing env to subprocesses.
 */

import type { AgentType, SessionConfigOption } from '@agemon/shared';

/** Strategy for parsing config options from a session/new response. */
export type ConfigOptionParser = (result: Record<string, unknown>) => SessionConfigOption[];

export interface AgentConfig {
  command: string[];
  passEnvVars: string[];
  label: string;
  parseConfigOptions: ConfigOptionParser;
}

// ─── Per-Agent Config Option Parsers ────────────────────────────────────────

/**
 * Claude agent: uses unified `configOptions` array in session/new response.
 * Each entry: { id, name, type: 'select', currentValue, options: [{ value, name }] }
 */
function parseClaudeConfigOptions(result: Record<string, unknown>): SessionConfigOption[] {
  const raw = result.configOptions as Array<{
    id?: string; name?: string; type?: string; currentValue?: string;
    options?: Array<{ value: string; name?: string }>;
  }> | undefined;

  if (!Array.isArray(raw)) return [];

  return raw
    .filter(o => o.id && o.type === 'select' && Array.isArray(o.options))
    .map(o => ({
      id: o.id!,
      type: 'select' as const,
      label: o.name ?? o.id!,
      value: o.currentValue ?? '',
      options: (o.options ?? []).map(v => ({ value: v.value, label: v.name ?? v.value })),
    }));
}

/**
 * OpenCode: uses separate `models` and `modes` top-level fields.
 * models: { currentModelId, availableModels: [{ modelId, name }] }
 * modes:  { currentModeId, availableModes: [{ id, name }] }
 */
function parseOpenCodeConfigOptions(result: Record<string, unknown>): SessionConfigOption[] {
  const options: SessionConfigOption[] = [];

  const models = result.models as {
    currentModelId?: string;
    availableModels?: Array<{ modelId: string; name?: string }>;
  } | undefined;
  if (models?.availableModels?.length) {
    options.push({
      id: 'model', type: 'select', label: 'Model',
      value: models.currentModelId ?? '',
      options: models.availableModels.map(m => ({ value: m.modelId, label: m.name ?? m.modelId })),
    });
  }

  const modes = result.modes as {
    currentModeId?: string;
    availableModes?: Array<{ id: string; name?: string }>;
  } | undefined;
  if (modes?.availableModes?.length) {
    options.push({
      id: 'mode', type: 'select', label: 'Mode',
      value: modes.currentModeId ?? '',
      options: modes.availableModes.map(m => ({ value: m.id, label: m.name ?? m.id })),
    });
  }

  return options;
}

/** No-op parser for agents that don't advertise config options yet. */
function parseNoConfigOptions(_result: Record<string, unknown>): SessionConfigOption[] {
  return [];
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  'claude-code': {
    command: ['claude-agent-acp', '--agent', 'claude-code'],
    passEnvVars: [],
    label: 'Claude Code (via claude-agent-acp)',
    parseConfigOptions: parseClaudeConfigOptions,
  },
  'opencode': {
    command: ['opencode', 'acp'],
    passEnvVars: ['OPENCODE_API_KEY'],
    label: 'OpenCode',
    parseConfigOptions: parseOpenCodeConfigOptions,
  },
  'aider': {
    command: ['aider', '--acp'],
    passEnvVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    label: 'Aider',
    parseConfigOptions: parseNoConfigOptions,
  },
  'gemini': {
    command: ['gemini', '--experimental-acp'],
    passEnvVars: ['GOOGLE_API_KEY'],
    label: 'Gemini CLI',
    parseConfigOptions: parseNoConfigOptions,
  },
};

/** System env vars that agents need to function (PATH, HOME, locale, etc.) */
const ALLOWED_SYSTEM_VARS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'NODE_ENV', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
];

/**
 * Build a safe environment for agent subprocesses.
 * Uses a whitelist approach: only system essentials + agent-specific vars are passed.
 */
export function buildAgentEnv(agentType: AgentType): Record<string, string> {
  const config = AGENT_CONFIGS[agentType];
  const env: Record<string, string> = {};

  for (const key of [...ALLOWED_SYSTEM_VARS, ...config.passEnvVars]) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
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

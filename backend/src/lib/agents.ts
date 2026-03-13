/**
 * Per-agent spawn configuration.
 *
 * Each supported agent type has a command template, required env vars,
 * and a human-readable label. The buildAgentEnv helper strips sensitive
 * Agemon variables before passing env to subprocesses.
 */

import { join } from 'path';
import { homedir } from 'os';
import type { AgentType, SessionConfigOption, ToolCallDisplay } from '@agemon/shared';

/** Strategy for parsing config options from a session/new response. */
export type ConfigOptionParser = (result: Record<string, unknown>) => SessionConfigOption[];

/**
 * Path inside ~/.agemon/tasks/{taskId}/ where this agent discovers plugins.
 * e.g. '.claude/plugins' → ~/.agemon/tasks/{taskId}/.claude/plugins/
 *
 * Also used at startup to symlink ~/.agemon/plugins into the agent's
 * global discovery directory (e.g. ~/.claude/plugins/agemon).
 */
export interface AgentPluginPath {
  /** Relative path from task dir for per-task plugin wiring */
  taskRelative: string;
  /** Absolute dir in user home for global plugin symlink (e.g. ~/.claude/plugins) */
  globalDir: string;
}

/**
 * Path inside ~/.agemon/tasks/{taskId}/ where this agent discovers skills.
 * e.g. '.claude/skills' → ~/.agemon/tasks/{taskId}/.claude/skills/
 *
 * Per the Agent Skills spec (agentskills.io), agents scan both client-specific
 * and cross-client (.agents/skills/) directories at project and user level.
 * globalDir is optional — set it to also symlink ~/.agemon/skills into the
 * agent's user-level discovery dir (e.g. ~/.agents/skills, ~/.claude/skills).
 */
export interface AgentSkillPath {
  /** Relative path from task dir for per-task skill wiring */
  taskRelative: string;
  /** Absolute dir in user home for global skill symlink (optional) */
  globalDir?: string;
}

export interface ToolDisplayResult {
  output?: string;
  error?: string;
  display?: ToolCallDisplay;
}

export interface AgentConfig {
  command: string[];
  passEnvVars: string[];
  label: string;
  parseConfigOptions: ConfigOptionParser;
  /** Extract display data + output from a tool_call_update. Agent-specific metadata handling. */
  parseToolDisplay: (update: Record<string, unknown>) => ToolDisplayResult;
  /** Where this agent looks for plugins. Empty array = no plugin discovery. */
  pluginPaths: AgentPluginPath[];
  /** Where this agent looks for skills. Empty array = no skill discovery. */
  skillPaths: AgentSkillPath[];
  /**
   * True if the agent automatically reads CLAUDE.md / AGENTS.md from cwd.
   * When true, first-prompt context injection is skipped (context arrives via file).
   * When false, context is prepended to the first user prompt.
   */
  autoLoadsContextFile: boolean;
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

// ─── Per-Agent Tool Display Extractors ────────────────────────────────────

/** Claude Code: extract toolResponse from _meta.claudeCode + rawOutput */
function parseClaudeToolDisplay(update: Record<string, unknown>): ToolDisplayResult {
  const meta = (update as Record<string, unknown>)?._meta as Record<string, unknown> | undefined;
  const claudeCode = meta?.claudeCode as Record<string, unknown> | undefined;
  const rawOutput = typeof update.rawOutput === 'string' ? update.rawOutput.slice(0, 2000) : undefined;
  const toolResponse = claudeCode?.toolResponse;
  const display = toolResponse && typeof toolResponse === 'object'
    ? { ...toolResponse } as ToolCallDisplay
    : undefined;
  const error = typeof update.error === 'string' ? update.error : undefined;
  return { output: rawOutput, error, display };
}

/** Generic: extract rawOutput and error only (no agent-specific _meta) */
function parseGenericToolDisplay(update: Record<string, unknown>): ToolDisplayResult {
  const rawOutput = typeof update.rawOutput === 'string' ? update.rawOutput.slice(0, 2000) : undefined;
  const error = typeof update.error === 'string' ? update.error : undefined;
  return { output: rawOutput, error };
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  'claude-code': {
    command: ['claude-agent-acp', '--agent', 'claude-code'],
    passEnvVars: [],
    label: 'Claude Code (via claude-agent-acp)',
    parseConfigOptions: parseClaudeConfigOptions,
    parseToolDisplay: parseClaudeToolDisplay,
    pluginPaths: [{
      taskRelative: '.claude/plugins',
      globalDir: join(homedir(), '.claude', 'plugins'),
    }],
    skillPaths: [
      { taskRelative: '.claude/skills', globalDir: join(homedir(), '.claude', 'skills') },
      { taskRelative: '.agents/skills', globalDir: join(homedir(), '.agents', 'skills') },
    ],
    autoLoadsContextFile: true,  // reads CLAUDE.md from cwd automatically
  },
  'opencode': {
    command: ['opencode', 'acp'],
    passEnvVars: ['OPENCODE_API_KEY'],
    label: 'OpenCode',
    parseConfigOptions: parseOpenCodeConfigOptions,
    parseToolDisplay: parseGenericToolDisplay,
    pluginPaths: [],
    skillPaths: [
      { taskRelative: '.agents/skills', globalDir: join(homedir(), '.agents', 'skills') },
    ],
    autoLoadsContextFile: false,
  },
  'gemini': {
    command: ['gemini', '--experimental-acp'],
    passEnvVars: ['GOOGLE_API_KEY'],
    label: 'Gemini CLI',
    parseConfigOptions: parseOpenCodeConfigOptions,
    parseToolDisplay: parseGenericToolDisplay,
    pluginPaths: [],
    skillPaths: [
      { taskRelative: '.agents/skills', globalDir: join(homedir(), '.agents', 'skills') },
    ],
    autoLoadsContextFile: false,
  },
  'pi': {
    command: ['pi-acp'],
    passEnvVars: ['ANTHROPIC_API_KEY'],
    label: 'Pi',
    parseConfigOptions: parseOpenCodeConfigOptions,
    parseToolDisplay: parseGenericToolDisplay,
    pluginPaths: [],
    skillPaths: [
      { taskRelative: '.agents/skills', globalDir: join(homedir(), '.agents', 'skills') },
    ],
    autoLoadsContextFile: false,
  },
  'codex': {
    command: ['codex-acp'],
    passEnvVars: ['OPENAI_API_KEY'],
    label: 'Codex',
    parseConfigOptions: parseClaudeConfigOptions,
    parseToolDisplay: parseGenericToolDisplay,
    pluginPaths: [],
    skillPaths: [
      { taskRelative: '.agents/skills', globalDir: join(homedir(), '.agents', 'skills') },
    ],
    autoLoadsContextFile: true,  // reads AGENTS.md from cwd automatically
  },
};

/** Collect all unique plugin discovery paths across all agents. */
export function getAllPluginPaths(): AgentPluginPath[] {
  const seen = new Set<string>();
  const paths: AgentPluginPath[] = [];
  for (const config of Object.values(AGENT_CONFIGS)) {
    for (const p of config.pluginPaths) {
      const key = `${p.globalDir}::${p.taskRelative}`;
      if (!seen.has(key)) {
        seen.add(key);
        paths.push(p);
      }
    }
  }
  return paths;
}

/** Collect all unique skill discovery paths across all agents. */
export function getAllSkillPaths(): AgentSkillPath[] {
  const seen = new Set<string>();
  const paths: AgentSkillPath[] = [];
  for (const config of Object.values(AGENT_CONFIGS)) {
    for (const p of config.skillPaths) {
      if (!seen.has(p.taskRelative)) {
        seen.add(p.taskRelative);
        paths.push(p);
      }
    }
  }
  return paths;
}

/** System env vars that agents need to function (PATH, HOME, locale, etc.) */
const ALLOWED_SYSTEM_VARS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'NODE_ENV', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
];

/**
 * Common user binary directories that may not be in PATH when the server
 * is launched from a non-interactive context (systemd, launchd, IDE, etc.).
 */
function getExpandedPath(): string {
  const base = process.env.PATH ?? '';
  const home = process.env.HOME;
  if (!home) return base;

  const extraDirs = [
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.opencode/bin`,
    `${home}/go/bin`,
    `${home}/.cargo/bin`,
    `${home}/.npm-global/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];

  const existing = new Set(base.split(':'));
  const additions = extraDirs.filter(d => !existing.has(d));
  return additions.length ? `${base}:${additions.join(':')}` : base;
}

/** Cached expanded PATH (computed once). */
let _expandedPath: string | null = null;
function expandedPath(): string {
  if (_expandedPath === null) _expandedPath = getExpandedPath();
  return _expandedPath;
}

/**
 * Build a safe environment for agent subprocesses.
 * Uses a whitelist approach: only system essentials + agent-specific vars are passed.
 * PATH is expanded with common user binary directories to handle non-interactive launches.
 */
export function buildAgentEnv(agentType: AgentType): Record<string, string> {
  const config = AGENT_CONFIGS[agentType];
  const env: Record<string, string> = {};

  for (const key of [...ALLOWED_SYSTEM_VARS, ...config.passEnvVars]) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }

  // Always use expanded PATH for child processes
  env.PATH = expandedPath();

  return env;
}

/**
 * Resolve the agent binary path on the system PATH.
 * Uses the expanded PATH to find binaries in common user directories.
 * Throws a descriptive error if the binary is not found.
 */
export function resolveAgentBinary(agentType: AgentType): string {
  const config = AGENT_CONFIGS[agentType];
  const binary = config.command[0];

  // Search with expanded PATH so we find binaries in ~/.local/bin, etc.
  const path = Bun.which(binary, { PATH: expandedPath() });
  if (!path) {
    throw new Error(
      `${binary} not found on PATH. Agent type: ${agentType} (${config.label}). ` +
      `Searched: ${expandedPath()}`
    );
  }
  return path;
}

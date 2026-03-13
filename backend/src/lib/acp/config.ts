import { db } from '../../db/client.ts';
import { sessions } from './session-registry.ts';
import type { SessionConfigOption, AgentCommand } from '@agemon/shared';

/**
 * Set a config option on a running ACP session (e.g. change model).
 * Sends session/set_config_option to the agent process.
 */
export async function setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) {
    throw new Error(`No active session found with id ${sessionId}`);
  }
  if (!entry.acpSessionId) {
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  await entry.transport.request('session/set_config_option', {
    sessionId: entry.acpSessionId,
    configOptionId: configId,
    value,
  });
}

/**
 * Get config options for a running session (from memory) or from DB for stopped sessions.
 */
export function getSessionConfigOptions(sessionId: string): SessionConfigOption[] {
  const entry = sessions.get(sessionId);
  if (entry) return entry.configOptions;
  return db.getSessionConfigOptions(sessionId) ?? [];
}

/**
 * Get available commands for a running session (from memory) or from DB for stopped sessions.
 */
export function getSessionAvailableCommands(sessionId: string): AgentCommand[] {
  const entry = sessions.get(sessionId);
  if (entry) return entry.availableCommands;
  return db.getSessionAvailableCommands(sessionId) ?? [];
}

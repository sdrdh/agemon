/**
 * ACP (Agent Client Protocol) session manager.
 *
 * Spawns agent processes, performs the JSON-RPC 2.0 handshake
 * (initialize → session/new), waits for user prompt, then fires
 * session/prompt. Maps agent session/update notifications to
 * internal event types and handles graceful shutdown.
 *
 * Session lifecycle: starting → ready → running → stopped/crashed
 * - ready = process spawned + ACP handshake done, waiting for first prompt
 * - running = prompt turn in flight
 */

// Re-export public API from domain modules
export { spawnAndHandshake } from './spawn.ts';
export { sendPromptTurn, sendInputToAgent } from './prompt.ts';
export { resumeSession } from './resume.ts';
export { resolveApproval } from './approvals.ts';
export { stopAgent, getActiveSession, recoverInterruptedSessions, shutdownAllSessions, cancelTurn } from './lifecycle.ts';
export { setSessionConfigOption, getSessionConfigOptions, getSessionAvailableCommands } from './config.ts';
export { extractToolName, extractToolContext } from './tool-helpers.ts';

// Re-export types for external use
export type { RunningSession } from './session-registry.ts';

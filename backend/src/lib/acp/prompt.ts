import { randomUUID } from 'crypto';
import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions } from './session-registry.ts';
import { deriveTaskStatus } from './task-status.ts';
import { flushCurrentMessage } from './notifications.ts';
import { AGENT_CONFIGS } from '../agents.ts';
import { buildFirstPromptContext } from '../context.ts';
import type { AgentType, SessionUsage } from '@agemon/shared';

/**
 * Send a prompt turn to a session. Handles both first prompt (ready → running)
 * and follow-up prompts.
 * Throws if a turn is already in flight.
 */
export async function sendPromptTurn(sessionId: string, content: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) {
    throw new Error(`No active session found with id ${sessionId}`);
  }

  if (entry.turnInFlight) {
    throw new Error('Agent is still processing');
  }

  entry.turnInFlight = true;

  const sessionRecord = db.getSession(sessionId);
  if (sessionRecord) deriveTaskStatus(sessionRecord.task_id);
  if (!sessionRecord) {
    entry.turnInFlight = false;
    throw new Error(`Session ${sessionId} not found in database`);
  }
  const taskId = sessionRecord.task_id;

  // Store user message as an acp_event with type 'prompt'
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'prompt',
    content,
  });

  if (!entry.acpSessionId) {
    entry.turnInFlight = false;
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  // If session is in `ready` state, transition to `running`
  if (sessionRecord.state === 'ready') {
    db.updateSessionState(sessionId, 'running');
    broadcast({
      type: 'session_state_changed',
      sessionId,
      taskId,
      state: 'running',
    });
    deriveTaskStatus(taskId);
  }

  // Set session name from first prompt (if not already named)
  const sessionForName = db.getSession(sessionId);
  if (sessionForName && !sessionForName.name) {
    const name = content.length > 50 ? content.slice(0, 47) + '...' : content;
    db.updateSessionName(sessionId, name);
  }

  // On the first prompt, inject task context for agents that don't auto-load CLAUDE.md
  let promptContent = content;
  const isFirstPrompt = entry.promptsSent === 0;
  if (isFirstPrompt && !AGENT_CONFIGS[entry.agentType].autoLoadsContextFile) {
    try {
      const task = db.getTask(taskId);
      if (task) {
        const contextBlock = await buildFirstPromptContext(task);
        promptContent = `${contextBlock}\n\n${content}`;
      }
    } catch (err) {
      console.warn(`[acp] failed to build first-prompt context for session ${sessionId}:`, err);
    }
  }
  entry.promptsSent += 1;

  try {
    const result = await entry.transport.request('session/prompt', {
      sessionId: entry.acpSessionId,
      prompt: [{ type: 'text', text: promptContent }],
    });

    // Check for cancelled stop reason — cleanup handled by finally block
    const resultObj = result as Record<string, unknown> | undefined;
    if (resultObj?.stopReason === 'cancelled') {
      console.info(`[acp] session ${sessionId} prompt turn cancelled`);
      broadcast({ type: 'turn_cancelled', sessionId, taskId });
      return;
    }

    // Extract usage from session/prompt result (guaranteed at end of turn)
    const usageObj = resultObj?.usage as Record<string, unknown> | undefined;
    if (usageObj) {
      const DEFAULT_CONTEXT_WINDOW: Record<AgentType, number> = {
        'claude-code': 200_000,
        'opencode': 200_000,
        'gemini': 1_000_000,
        'pi': 200_000,
        'codex': 258_400,
      };
      const agentType = entry.agentType;
      const defaultWindow = DEFAULT_CONTEXT_WINDOW[agentType] ?? 200_000;

      // ACP protocol uses: used, size (total tokens, context window size)
      // Some agents send: totalTokens, inputTokens, outputTokens (opencode)
      const used = typeof usageObj.used === 'number' ? usageObj.used
        : typeof usageObj.totalTokens === 'number' ? usageObj.totalTokens
        : 0;
      const size = (typeof usageObj.size === 'number' ? usageObj.size
        : typeof usageObj.contextWindow === 'number' ? usageObj.contextWindow
        : defaultWindow) || defaultWindow;

      const inputTokens = typeof usageObj.inputTokens === 'number' ? usageObj.inputTokens : 0;
      const outputTokens = typeof usageObj.outputTokens === 'number' ? usageObj.outputTokens : 0;

      // If agent only sends used/size, estimate input/output split
      const finalInputTokens = inputTokens || Math.floor(used * 0.7);
      const finalOutputTokens = outputTokens || Math.floor(used * 0.3);

      const usage: SessionUsage = {
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        cachedReadTokens: typeof usageObj.cachedReadTokens === 'number' ? usageObj.cachedReadTokens
          : typeof usageObj.cacheReadInputTokens === 'number' ? usageObj.cacheReadInputTokens : 0,
        cachedWriteTokens: typeof usageObj.cachedWriteTokens === 'number' ? usageObj.cachedWriteTokens
          : typeof usageObj.cacheCreationInputTokens === 'number' ? usageObj.cacheCreationInputTokens : 0,
        contextWindow: size,
      };
      db.updateSessionUsage(sessionId, usage);
      broadcast({ type: 'session_usage_update', sessionId, taskId, usage });
    }

    console.info(`[acp] session ${sessionId} prompt turn completed`);
  } catch (err) {
    if (!entry.transport.isClosed) {
      console.error(`[acp] prompt turn error for session ${sessionId}:`, err);
    }
  } finally {
    flushCurrentMessage(sessionId, taskId);
    entry.turnInFlight = false;
    broadcast({ type: 'turn_completed', sessionId, taskId });
    deriveTaskStatus(taskId);
  }
}

/**
 * Send a user's input response to the running agent via JSON-RPC.
 * Returns true if the message was sent, false if no active session was found.
 */
export function sendInputToAgent(sessionId: string, inputId: string, response: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) return false;

  entry.transport.notify('acp/inputResponse', { inputId, response });
  return true;
}

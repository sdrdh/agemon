import { randomUUID } from 'crypto';
import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions } from './session-registry.ts';
import { extractToolName, extractToolContext } from './tool-helpers.ts';
import { AGENT_CONFIGS } from '../agents.ts';
import type { AgentType, AgentCommand, SessionUsage, ToolCallEvent, ToolCallStatus, ToolCallUpdateEvent, SessionConfigOption } from '@agemon/shared';

/** Dispatch to the agent-specific config option parser. */
function parseConfigOptions(agentType: AgentType, result: Record<string, unknown>): SessionConfigOption[] {
  return AGENT_CONFIGS[agentType].parseConfigOptions(result);
}

/**
 * Map ACP session/update notifications to internal event types and broadcast.
 */
export function handleNotification(
  method: string,
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  // Handle session/update notifications from the agent
  if (method === 'session/update') {
    handleSessionUpdate(params, sessionId, taskId);
    return;
  }

  // Handle __raw__ (non-JSON-RPC output from the agent process)
  if (method === '__raw__') {
    const line =
      params && typeof params === 'object' && 'line' in (params as Record<string, unknown>)
        ? String((params as Record<string, unknown>).line)
        : String(params);

    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content: line,
    });
    broadcast({ type: 'agent_thought', taskId, sessionId, content: line, eventType: 'thought' });
    return;
  }

  // Unknown notification method — log as thought
  const content = JSON.stringify(params);
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'thought',
    content: `[${method}] ${content}`,
  });
  broadcast({ type: 'agent_thought', taskId, sessionId, content: `[${method}] ${content}`, eventType: 'thought' });
}

/**
 * Flush any accumulated streaming message to the database.
 * Called when a non-chunk update arrives or when the prompt turn completes.
 */
export function flushCurrentMessage(sessionId: string, taskId: string): void {
  const rs = sessions.get(sessionId);
  if (!rs || !rs.currentMessageId || !rs.currentMessageText) return;

  try {
    db.insertEvent({
      id: rs.currentMessageId,
      task_id: taskId,
      session_id: sessionId,
      type: rs.currentMessageType,
      content: rs.currentMessageText,
    });
  } catch (err) {
    console.error(`[acp] failed to persist message ${rs.currentMessageId} for session ${sessionId}:`, err);
  }

  // Update last_message on agent visible messages only (not thoughts or tool calls)
  if (rs.currentMessageType === 'action') {
    const text = rs.currentMessageText;
    // Skip tool-call JSON and [tool] prefixed lines — they're not readable messages
    if (!text.startsWith('{') && !text.startsWith('[tool')) {
      const preview = text.length > 100 ? text.slice(0, 97) + '...' : text;
      db.updateSessionLastMessage(sessionId, preview);
    }
  }

  // Always reset buffer so subsequent flushes don't cascade-fail with duplicate IDs
  rs.currentMessageId = null;
  rs.currentMessageText = '';
}

/**
 * Handle a session/update notification from the ACP agent.
 * The update contains a `sessionUpdate` field indicating the type.
 *
 * For streaming chunks (agent_message_chunk, agent_thought_chunk), we
 * accumulate text under a stable messageId and only persist to DB when
 * a non-chunk update arrives or the turn completes.
 */
export function handleSessionUpdate(
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  const obj = params as Record<string, unknown> | undefined;
  const update = obj?.update as Record<string, unknown> | undefined;
  if (!update || !('sessionUpdate' in update)) {
    return;
  }

  const updateType = update.sessionUpdate as string;
  const rs = sessions.get(sessionId);

  switch (updateType) {
    case 'agent_message_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      // Start a new streaming message if needed, or continue accumulating
      if (!rs.currentMessageId || rs.currentMessageType !== 'action') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'action';
      }
      rs.currentMessageText += text;

      // Broadcast the delta with a stable messageId so frontend can merge
      broadcast({
        type: 'agent_thought', taskId, sessionId, content: text,
        eventType: 'action', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'agent_thought_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      if (!rs.currentMessageId || rs.currentMessageType !== 'thought') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'thought';
      }
      rs.currentMessageText += text;

      broadcast({
        type: 'agent_thought', taskId, sessionId, content: text,
        eventType: 'thought', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'tool_call': {
      // Flush any pending streaming message before tool output
      flushCurrentMessage(sessionId, taskId);

      const toolCall = update as Record<string, unknown>;
      const toolCallId = (update.toolCallId as string) ?? '';
      const title = (update.title as string) ?? 'tool';
      const status = ((update.status as string) ?? 'pending') as ToolCallStatus;
      const kind = extractToolName(toolCall);
      const args = extractToolContext(toolCall);

      const startedAt = new Date().toISOString();
      const event: ToolCallEvent = { toolCallId, kind, title, status, args, startedAt };
      const content = JSON.stringify(event);

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, sessionId, content, eventType: 'action' });
      break;
    }

    case 'tool_call_update': {
      const toolCallId = (update.toolCallId as string) ?? '';
      const status = ((update.status as string) ?? '') as ToolCallStatus;

      // tool_call_update carries the actual rawInput, updated title, and kind
      const title = (update.title as string) || undefined;
      const kind = extractToolName(update as Record<string, unknown>) || undefined;
      const args = extractToolContext(update as Record<string, unknown>);
      const hasArgs = Object.keys(args).length > 0;

      // Extract output/display using agent-specific parser
      const agentType = rs?.agentType ?? 'claude-code';
      const { output, error, display } = AGENT_CONFIGS[agentType].parseToolDisplay(update as Record<string, unknown>);
      const hasDisplayData = !!(output || error || display);

      // Add completedAt when status is completed or failed
      const completedAt = (status === 'completed' || status === 'failed') ? new Date().toISOString() : undefined;

      // Skip if there's nothing useful to report
      if (!status && !title && !hasArgs && !hasDisplayData) return;

      const event: ToolCallUpdateEvent = {
        toolCallId,
        status: status || 'in_progress',
        isUpdate: true,
        ...(title ? { title } : {}),
        ...(kind && kind !== 'unknown' ? { kind } : {}),
        ...(hasArgs ? { args } : {}),
        ...(output ? { output } : {}),
        ...(error ? { error } : {}),
        ...(display ? { display } : {}),
        ...(completedAt ? { completedAt } : {}),
      };
      const content = JSON.stringify(event);

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, sessionId, content, eventType: 'action' });
      break;
    }

    case 'config_options_update': {
      if (!rs) break;

      // Reuse the same parser — notification wraps configOptions the same way as session/new
      const parsed = parseConfigOptions(rs.agentType,update as Record<string, unknown>);
      if (parsed.length === 0) break;

      rs.configOptions = parsed;
      db.updateSessionConfigOptions(sessionId, rs.configOptions);
      broadcast({ type: 'config_options_updated', sessionId, taskId, configOptions: rs.configOptions });
      console.info(`[acp] session ${sessionId} config options updated: ${parsed.map(o => o.id).join(', ')}`);
      break;
    }

    case 'available_commands_update': {
      const commands = (update.availableCommands as AgentCommand[]) ?? [];
      if (rs) {
        rs.availableCommands = commands;
        db.updateSessionAvailableCommands(sessionId, commands);
      }
      broadcast({ type: 'available_commands', sessionId, taskId, commands });
      console.info(`[acp] session ${sessionId} available commands: ${commands.map(c => c.name).join(', ')}`);
      break;
    }

    case 'usage_update': {
      flushCurrentMessage(sessionId, taskId);
      const DEFAULT_CONTEXT_WINDOW: Record<AgentType, number> = {
        'claude-code': 200_000,
        'opencode': 200_000,
        'gemini': 1_000_000,
        'pi': 200_000,
        'codex': 258_400,
      };

      const agentType = rs?.agentType ?? 'claude-code';
      const defaultWindow = DEFAULT_CONTEXT_WINDOW[agentType] ?? 200_000;

      // ACP protocol uses: used, size, inputTokens, outputTokens (may vary by agent)
      // - claude-agent-acp uses: used, size (total tokens, context window size)
      // - Some agents send: inputTokens, outputTokens, contextWindow
      const used = typeof update.used === 'number' ? update.used : 0;
      const size = (typeof update.size === 'number' ? update.size
        : typeof update.contextWindow === 'number' ? update.contextWindow
        : defaultWindow) || defaultWindow;

      // Some agents send detailed token breakdown
      const inputTokens = typeof update.inputTokens === 'number' ? update.inputTokens : 0;
      const outputTokens = typeof update.outputTokens === 'number' ? update.outputTokens : 0;

      // If agent only sends used/size, estimate input/output split (rough approximation)
      const finalInputTokens = inputTokens || Math.floor(used * 0.7);
      const finalOutputTokens = outputTokens || Math.floor(used * 0.3);

      // Extract cost if reported (e.g. OpenCode sends { cost: { amount, currency } })
      const costObj = update.cost as { amount?: number } | undefined;
      const cost = typeof costObj?.amount === 'number' ? costObj.amount : undefined;

      const usage: SessionUsage = {
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        cachedReadTokens: typeof update.cachedReadTokens === 'number' ? update.cachedReadTokens
          : typeof update.cacheReadInputTokens === 'number' ? update.cacheReadInputTokens : 0,
        cachedWriteTokens: typeof update.cachedWriteTokens === 'number' ? update.cachedWriteTokens
          : typeof update.cacheCreationInputTokens === 'number' ? update.cacheCreationInputTokens : 0,
        contextWindow: size,
        ...(cost !== undefined ? { cost } : {}),
      };

      console.info(`[acp] session ${sessionId} usage: ${used}/${size} tokens (${Math.round(used/size*100)}% ctx)${cost !== undefined ? ` $${cost.toFixed(4)}` : ''}`);

      db.updateSessionUsage(sessionId, usage);
      broadcast({ type: 'session_usage_update', sessionId, taskId, usage });
      break;
    }

    default: {
      // Unknown update types — ignore silently
      break;
    }
  }
}

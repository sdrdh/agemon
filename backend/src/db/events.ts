/**
 * Event/chat-history queries.
 * All data comes from per-session JSONL files + in-memory approval/input stores.
 * No on-disk SQLite dependency.
 */
import { readSessionEventsSync, getLastNonPromptEventSync } from '../lib/acp/event-log.ts';
import * as approvalStore from '../lib/approval-store.ts';
import * as inputStore from '../lib/input-store.ts';
import type { ChatMessage } from '@agemon/shared';

const EVENT_TYPE_MAP: Record<string, ChatMessage['eventType']> = {
  thought: 'thought',
  action: 'action',
  await_input: 'input_request',
  result: 'action',
  prompt: 'prompt',
  input_response: 'input_response',
  approval_request: 'approval_request',
};

/**
 * Get the last agent message for a session (used by dashboard previews).
 * Returns the content of the last non-prompt event (thought, action, result, etc.).
 */
export function getLastAgentMessage(sessionId: string): string | null {
  return getLastNonPromptEventSync(sessionId);
}

/**
 * Chat history for a single session.
 * Merges JSONL events + in-memory inputs + in-memory approvals.
 */
export function listChatHistoryBySession(sessionId: string, limit: number, before?: string): ChatMessage[] {
  const events = readSessionEventsSync(sessionId);

  const messages: ChatMessage[] = events
    .filter(e => !before || e.ts < before)
    .map((e): ChatMessage => ({
      id: e.id,
      role: e.type === 'prompt' ? 'user' : 'agent',
      content: e.content,
      eventType: EVENT_TYPE_MAP[e.type] ?? 'thought',
      timestamp: e.ts,
    }));

  // Merge answered inputs from in-memory store
  const inputs = inputStore.listInputsBySession(sessionId);
  for (const input of inputs) {
    if (input.status !== 'answered' || !input.response) continue;
    if (before && input.created_at >= before) continue;
    messages.push({
      id: input.id,
      role: 'user',
      content: input.response,
      eventType: 'input_response',
      timestamp: input.created_at,
    });
  }

  // Merge approvals from in-memory store
  const approvals = approvalStore.listApprovalsBySession(sessionId);
  for (const a of approvals) {
    if (before && a.createdAt >= before) continue;
    messages.push({
      id: `approval-${a.id}`,
      role: 'system',
      content: `${a.id}:${a.status}:${a.toolName}`,
      eventType: 'approval_request',
      timestamp: a.createdAt,
    });
  }

  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return messages.length > limit ? messages.slice(messages.length - limit) : messages;
}


import type { ToolCall } from '@/lib/store';

/**
 * Apply a parsed tool call JSON event (initial or update) to the store.
 * Shared between WS provider (real-time) and rehydration (page reload).
 */
export function applyToolCallEvent(
  parsed: Record<string, unknown>,
  sessionId: string,
  upsertToolCall: (sessionId: string, toolCallId: string, patch: Partial<ToolCall>) => void,
): void {
  if (!parsed || typeof parsed.toolCallId !== 'string') return;

  if (!parsed.isUpdate) {
    // ToolCallEvent — initial entry
    upsertToolCall(sessionId, parsed.toolCallId as string, {
      kind: parsed.kind as string,
      title: parsed.title as string,
      args: (parsed.args as Record<string, string>) ?? {},
      status: (parsed.status as ToolCall['status']) ?? 'pending',
      startedAt: (parsed.startedAt as string) ?? new Date().toISOString(),
    });
  } else {
    // ToolCallUpdateEvent — merge update
    const patch: Partial<ToolCall> = {};
    if (parsed.status) patch.status = parsed.status as ToolCall['status'];
    if (parsed.title) patch.title = parsed.title as string;
    if (parsed.kind) patch.kind = parsed.kind as string;
    if (parsed.args) patch.args = parsed.args as Record<string, string>;
    if (parsed.output) patch.output = parsed.output as string;
    if (parsed.error) patch.error = parsed.error as string;
    if (parsed.display) patch.display = parsed.display as ToolCall['display'];
    if (parsed.completedAt) patch.completedAt = parsed.completedAt as string;
    upsertToolCall(sessionId, parsed.toolCallId as string, patch);
  }
}

/** Stable empty array for Zustand selector fallbacks. */
export const EMPTY_TOOL_CALLS: ToolCall[] = [];

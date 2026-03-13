/**
 * Pure tool helpers for extracting tool names and context from ACP notifications.
 */

/**
 * Extract tool name from an ACP tool call object.
 * Prioritizes _meta.claudeCode.toolName > kind > title.
 */
export function extractToolName(toolCall: Record<string, unknown> | undefined): string {
  if (!toolCall) return 'unknown';
  // Prefer _meta.claudeCode.toolName (e.g. "Read", "Bash", "Edit") — proper casing
  const meta = toolCall._meta as Record<string, unknown> | undefined;
  const claudeCode = meta?.claudeCode as Record<string, unknown> | undefined;
  if (claudeCode?.toolName) return claudeCode.toolName as string;
  if (meta?.toolName) return meta.toolName as string;
  // ACP generic kind (e.g. "read", "bash", "edit") as fallback
  if (toolCall.kind && typeof toolCall.kind === 'string') return toolCall.kind;
  const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;
  if (rawInput?.tool) return rawInput.tool as string;
  const title = toolCall.title as string | undefined;
  if (title) return title.split(/[\s:]/)[0];
  return 'unknown';
}

/**
 * Extract context (file paths, commands, etc.) from an ACP tool call object.
 * Used for displaying tool usage details in approval requests.
 */
export function extractToolContext(toolCall: Record<string, unknown> | undefined): Record<string, string> {
  if (!toolCall) return {};
  const ctx: Record<string, string> = {};
  const input = toolCall.rawInput as Record<string, unknown> | undefined;
  // Claude uses snake_case (file_path), OpenCode uses camelCase (filePath)
  if (input?.file_path) ctx.filePath = String(input.file_path);
  else if (input?.filePath) ctx.filePath = String(input.filePath);
  if (input?.command) ctx.command = String(input.command);
  if (input?.pattern) ctx.pattern = String(input.pattern);
  if (input?.path) ctx.path = String(input.path);
  if (input?.url) ctx.url = String(input.url);
  if (input?.content) ctx.preview = String(input.content).slice(0, 200);
  if (input?.old_string) ctx.oldString = String(input.old_string).slice(0, 200);
  else if (input?.oldString) ctx.oldString = String(input.oldString).slice(0, 200);
  if (input?.new_string) ctx.newString = String(input.new_string).slice(0, 200);
  else if (input?.newString) ctx.newString = String(input.newString).slice(0, 200);
  if (toolCall.title) ctx.title = String(toolCall.title);
  // Gemini/OpenCode send locations array (sometimes on tool_call_update, not tool_call)
  const locations = toolCall.locations as Array<{ path?: string }> | undefined;
  if (Array.isArray(locations) && locations.length > 0 && locations[0].path) {
    if (!ctx.filePath && !ctx.path) ctx.filePath = locations[0].path;
  }
  return ctx;
}

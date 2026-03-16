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

/**
 * Build a descriptive label for an approval option based on tool context.
 * Produces labels like:
 *   "Allow Bash(git branch -a)"
 *   "Always allow Write to /tmp/test.txt"
 *   "Always allow Edit in src/App.tsx"
 *   "Deny"
 */
export function buildOptionLabel(
  kind: string,
  toolName: string,
  toolTitle: string,
  context: Record<string, string>,
): string {
  const verb = kind === 'allow_once' ? 'Allow'
    : kind === 'allow_always' ? 'Always allow'
    : kind === 'deny' ? 'Deny'
    : kind.replace(/_/g, ' ');

  // For deny, keep it short
  if (kind === 'deny') return 'Deny';

  // Build a concise description of what's being approved
  const detail = buildToolDetail(toolName, toolTitle, context);
  return detail ? `${verb} ${detail}` : verb;
}

function buildToolDetail(
  toolName: string,
  toolTitle: string,
  ctx: Record<string, string>,
): string {
  const file = ctx.filePath || ctx.path || '';
  const shortFile = file ? shortenPath(file) : '';
  const cmd = ctx.command || '';

  switch (toolName.toLowerCase()) {
    case 'bash':
    case 'execute': {
      if (cmd) {
        // Show first meaningful token(s) of the command
        const short = cmd.length > 40 ? cmd.slice(0, 37) + '...' : cmd;
        return `Bash(${short})`;
      }
      return 'Bash command';
    }
    case 'write': {
      if (shortFile) return `Write to ${shortFile}`;
      return 'file write';
    }
    case 'edit': {
      if (shortFile) return `Edit in ${shortFile}`;
      return 'file edit';
    }
    case 'read': {
      if (shortFile) return `Read ${shortFile}`;
      return 'file read';
    }
    default: {
      // Use toolTitle if it's more descriptive than the name (e.g. "external_directory")
      const title = toolTitle !== toolName ? toolTitle.replace(/_/g, ' ') : '';
      if (shortFile) return title ? `${title} (${shortFile})` : shortFile;
      if (cmd) return title ? `${title}: ${cmd.slice(0, 30)}` : cmd.slice(0, 40);
      return title || toolName;
    }
  }
}

function shortenPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-2).join('/') : p;
}

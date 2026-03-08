import type { ChatMessage, AgentSessionState, ToolCallEvent, ToolCallUpdateEvent } from '@agemon/shared';

// ─── Types for grouped chat items ──────────────────────────────────────────

export interface ChatBubbleItem {
  kind: 'bubble';
  message: ChatMessage;
}

export interface ActivityGroupItem {
  kind: 'activity-group';
  messages: ChatMessage[];
}

export type ChatItem = ChatBubbleItem | ActivityGroupItem;

// ─── Tool call types ──────────────────────────────────────────────────

export interface ToolCallEntry {
  id: string;
  label: string;
  status: 'pending' | 'completed' | 'failed';
  kind: 'tool' | 'skill';
  toolKind?: string;          // e.g. "Bash", "Read", "Edit", "Grep"
  args?: Record<string, string>; // Tool-specific params for detail rendering
}

/** Try to parse content as a ToolCallEvent JSON. Returns null if not valid. */
function parseToolCallEvent(content: string): ToolCallEvent | null {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.toolCallId === 'string' && typeof obj.kind === 'string' && typeof obj.title === 'string') {
      return obj as ToolCallEvent;
    }
  } catch { /* not JSON */ }
  return null;
}

/** Try to parse content as a ToolCallUpdateEvent JSON. Returns null if not valid. */
function parseToolCallUpdateEvent(content: string): ToolCallUpdateEvent | null {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.toolCallId === 'string' && typeof obj.status === 'string' && !('kind' in obj)) {
      return obj as ToolCallUpdateEvent;
    }
  } catch { /* not JSON */ }
  return null;
}

// ─── Session state helpers ──────────────────────────────────────────────────

export const SESSION_STATE_DOT: Record<AgentSessionState, string> = {
  starting: 'bg-blue-500',
  ready: 'bg-cyan-500',
  running: 'bg-green-500',
  stopped: 'bg-zinc-400',
  crashed: 'bg-red-500',
  interrupted: 'bg-amber-500',
};

export const SESSION_STATE_LABEL: Record<AgentSessionState, string> = {
  starting: 'Starting',
  ready: 'Ready',
  running: 'Running',
  stopped: 'Stopped',
  crashed: 'Crashed',
  interrupted: 'Interrupted',
};

export function isSessionActive(state: AgentSessionState): boolean {
  return state === 'running' || state === 'ready' || state === 'starting';
}

export function isSessionTerminal(state: AgentSessionState): boolean {
  return state === 'stopped' || state === 'crashed' || state === 'interrupted';
}

// ─── Grouping logic ────────────────────────────────────────────────────────

export function isCollapsibleActivity(msg: ChatMessage): boolean {
  if (msg.role !== 'agent') return false;
  if (msg.eventType === 'thought') return true;
  if (msg.eventType === 'action') {
    // Structured JSON tool call or update
    if (parseToolCallEvent(msg.content) || parseToolCallUpdateEvent(msg.content)) return true;
    // Legacy string format fallback
    if (msg.content.startsWith('[tool')) return true;
  }
  return false;
}

export function groupMessages(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let currentGroup: ChatMessage[] = [];

  function flushGroup() {
    if (currentGroup.length > 0) {
      items.push({ kind: 'activity-group', messages: [...currentGroup] });
      currentGroup = [];
    }
  }

  for (const msg of messages) {
    if (isCollapsibleActivity(msg)) {
      currentGroup.push(msg);
    } else {
      flushGroup();
      items.push({ kind: 'bubble', message: msg });
    }
  }
  flushGroup();

  return items;
}

// ─── Tool call parsing ──────────────────────────────────────────────────

export function shortenToolLabel(label: string): string {
  const spaceIdx = label.indexOf(' ');
  if (spaceIdx < 0) return label;
  const toolName = label.slice(0, spaceIdx);
  const arg = label.slice(spaceIdx + 1).trim();
  if (arg.includes('/')) {
    const filename = arg.split('/').pop()?.replace(/\s*\(.*$/, '') ?? arg;
    return `${toolName} ${filename}`;
  }
  return label;
}

export function parseActivityMessages(messages: ChatMessage[]) {
  const toolCalls: ToolCallEntry[] = [];
  const toolCallMap = new Map<string, ToolCallEntry>();
  const thoughts: ChatMessage[] = [];
  let unnamedIdx = 0;

  for (const msg of messages) {
    // Try structured JSON format first
    const tcEvent = parseToolCallEvent(msg.content);
    if (tcEvent) {
      const entry: ToolCallEntry = {
        id: tcEvent.toolCallId || `unnamed-${unnamedIdx++}`,
        label: tcEvent.title,
        status: 'pending',
        kind: tcEvent.kind === 'Skill' ? 'skill' : 'tool',
        toolKind: tcEvent.kind,
        args: tcEvent.args,
      };
      toolCalls.push(entry);
      if (tcEvent.toolCallId) toolCallMap.set(tcEvent.toolCallId, entry);
      continue;
    }

    const updateEvent = parseToolCallUpdateEvent(msg.content);
    if (updateEvent) {
      const entry = toolCallMap.get(updateEvent.toolCallId);
      if (entry) {
        entry.status = updateEvent.status as 'completed' | 'failed';
      } else {
        const pending = toolCalls.find((tc) => tc.status === 'pending' && tc.id.startsWith('unnamed-'));
        if (pending) pending.status = updateEvent.status as 'completed' | 'failed';
      }
      continue;
    }

    // Legacy string format fallback
    const newMatch = msg.content.match(/^\[tool:([^\]]+)\]\s+(.+?)(?:\s*\((?:pending|in_progress|completed|failed)\))?\s*$/);
    if (newMatch) {
      const rawLabel = newMatch[2].trim();
      const toolName = rawLabel.split(' ')[0];
      const entry: ToolCallEntry = { id: newMatch[1], label: rawLabel, status: 'pending', kind: toolName === 'Skill' ? 'skill' : 'tool' };
      toolCalls.push(entry);
      toolCallMap.set(newMatch[1], entry);
      continue;
    }

    const oldMatch = msg.content.match(/^\[tool\]\s+(.+?)(?:\s*\((?:pending|in_progress|completed|failed)\))?\s*$/);
    if (oldMatch) {
      const fakeId = `unnamed-${unnamedIdx++}`;
      const rawLabel = oldMatch[1].trim();
      const toolName = rawLabel.split(' ')[0];
      toolCalls.push({ id: fakeId, label: rawLabel, status: 'pending', kind: toolName === 'Skill' ? 'skill' : 'tool' });
      continue;
    }

    const updateMatch = msg.content.match(/^\[tool update\]\s+(\S+):\s+(\S+)/);
    if (updateMatch) {
      const [, id, status] = updateMatch;
      const entry = toolCallMap.get(id);
      if (entry) {
        entry.status = status as 'completed' | 'failed';
      } else {
        const pending = toolCalls.find((tc) => tc.status === 'pending' && tc.id.startsWith('unnamed-'));
        if (pending) pending.status = status as 'completed' | 'failed';
      }
      continue;
    }

    thoughts.push(msg);
  }

  return { toolCalls, thoughts };
}

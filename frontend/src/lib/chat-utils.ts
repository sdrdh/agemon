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

export interface ToolCallItem {
  kind: 'tool-call';
  toolCallId: string;
  sessionId: string;
}

export type ChatItem = ChatBubbleItem | ActivityGroupItem | ToolCallItem;

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
    if (obj && typeof obj.toolCallId === 'string' && typeof obj.kind === 'string' && typeof obj.title === 'string' && typeof obj.status === 'string' && obj.args && typeof obj.args === 'object' && !obj.isUpdate) {
      return obj as ToolCallEvent;
    }
  } catch { /* not JSON */ }
  return null;
}

/** Try to parse content as a ToolCallUpdateEvent JSON. Returns null if not valid. */
function parseToolCallUpdateEvent(content: string): ToolCallUpdateEvent | null {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.toolCallId === 'string' && typeof obj.status === 'string' && obj.isUpdate === true) {
      return obj as ToolCallUpdateEvent;
    }
    // Legacy format without isUpdate discriminator
    if (obj && typeof obj.toolCallId === 'string' && typeof obj.status === 'string' && !('kind' in obj) && !('title' in obj)) {
      return obj as ToolCallUpdateEvent;
    }
  } catch { /* not JSON */ }
  return null;
}

// ─── Session state helpers ──────────────────────────────────────────────────

export const SESSION_STATE_DOT: Record<AgentSessionState, string> = {
  starting: 'bg-blue-500',
  ready: 'bg-cyan-500',
  running: 'bg-success',
  stopped: 'bg-zinc-400',
  crashed: 'bg-destructive',
  interrupted: 'bg-warning',
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

export function groupMessages(messages: ChatMessage[], sessionId?: string): ChatItem[] {
  const items: ChatItem[] = [];
  let currentGroup: ChatMessage[] = [];
  // Pre-parsed tool call IDs for the current group (avoids double-parse)
  let groupToolCallIds = new Set<string>();
  let groupThoughts: ChatMessage[] = [];
  // Maps each message index in currentGroup to its toolCallId (or null)
  let groupMsgToolIds: (string | null)[] = [];

  function flushGroup() {
    if (currentGroup.length === 0) return;

    // 1-3 unique tool calls → emit individual ToolCallItems + remaining as activity group
    if (sessionId && groupToolCallIds.size >= 1 && groupToolCallIds.size <= 3) {
      const emittedIds = new Set<string>();
      for (let i = 0; i < currentGroup.length; i++) {
        const tcId = groupMsgToolIds[i];
        if (tcId && !emittedIds.has(tcId)) {
          emittedIds.add(tcId);
          items.push({ kind: 'tool-call', toolCallId: tcId, sessionId });
        }
      }
      if (groupThoughts.length > 0) {
        items.push({ kind: 'activity-group', messages: groupThoughts });
      }
    } else {
      // 0 or 4+ tool calls → standard activity group
      items.push({ kind: 'activity-group', messages: [...currentGroup] });
    }
    currentGroup = [];
    groupToolCallIds = new Set();
    groupThoughts = [];
    groupMsgToolIds = [];
  }

  for (const msg of messages) {
    if (isCollapsibleActivity(msg)) {
      currentGroup.push(msg);
      // Track toolCallId in a single pass (no separate extractToolCallIds)
      let tcId: string | null = null;
      try {
        const obj = JSON.parse(msg.content);
        if (obj && typeof obj.toolCallId === 'string') tcId = obj.toolCallId;
      } catch { /* not JSON */ }
      groupMsgToolIds.push(tcId);
      if (tcId) {
        groupToolCallIds.add(tcId);
      } else {
        groupThoughts.push(msg);
      }
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
        status: (tcEvent.status === 'completed' || tcEvent.status === 'failed') ? tcEvent.status : 'pending',
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
      const target = entry ?? toolCalls.find((tc) => tc.status === 'pending' && tc.id.startsWith('unnamed-'));
      if (target) {
        if (updateEvent.status === 'completed' || updateEvent.status === 'failed') {
          target.status = updateEvent.status;
        }
        if (updateEvent.title) target.label = updateEvent.title;
        if (updateEvent.kind) {
          target.toolKind = updateEvent.kind;
          target.kind = updateEvent.kind === 'Skill' ? 'skill' : 'tool';
        }
        if (updateEvent.args && Object.keys(updateEvent.args).length > 0) {
          target.args = { ...target.args, ...updateEvent.args };
        }
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

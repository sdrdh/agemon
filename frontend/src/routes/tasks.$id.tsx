import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Square, Send, ChevronRight, ChevronDown, Check, X, Loader2, RotateCcw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/custom/status-badge';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { sendClientEvent } from '@/lib/ws';
import { taskDetailQuery, taskKeys, taskSessionsQuery, sessionChatQuery, sessionKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';
import type { ChatMessage, AgentSession, AgentSessionState } from '@agemon/shared';

// Stable empty array reference to prevent re-renders
const EMPTY_MESSAGES: ChatMessage[] = [];

// ─── Types for grouped chat items ──────────────────────────────────────────

interface ChatBubbleItem {
  kind: 'bubble';
  message: ChatMessage;
}

interface ActivityGroupItem {
  kind: 'activity-group';
  messages: ChatMessage[];
}

type ChatItem = ChatBubbleItem | ActivityGroupItem;

// ─── Grouping logic ────────────────────────────────────────────────────────

function isCollapsibleActivity(msg: ChatMessage): boolean {
  if (msg.role !== 'agent') return false;
  if (msg.eventType === 'thought') return true;
  if (msg.eventType === 'action' && msg.content.startsWith('[tool')) return true;
  return false;
}

function groupMessages(messages: ChatMessage[]): ChatItem[] {
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

interface ToolCallEntry {
  id: string;
  label: string;
  status: 'pending' | 'completed' | 'failed';
}

function shortenToolLabel(label: string): string {
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

function parseActivityMessages(messages: ChatMessage[]) {
  const toolCalls: ToolCallEntry[] = [];
  const toolCallMap = new Map<string, ToolCallEntry>();
  const thoughts: ChatMessage[] = [];
  let unnamedIdx = 0;

  for (const msg of messages) {
    const newMatch = msg.content.match(/^\[tool:([^\]]+)\]\s+(.+?)(?:\s*\((?:pending|in_progress|completed|failed)\))?\s*$/);
    if (newMatch) {
      const entry: ToolCallEntry = { id: newMatch[1], label: newMatch[2].trim(), status: 'pending' };
      toolCalls.push(entry);
      toolCallMap.set(newMatch[1], entry);
      continue;
    }

    const oldMatch = msg.content.match(/^\[tool\]\s+(.+?)(?:\s*\((?:pending|in_progress|completed|failed)\))?\s*$/);
    if (oldMatch) {
      const fakeId = `unnamed-${unnamedIdx++}`;
      toolCalls.push({ id: fakeId, label: oldMatch[1].trim(), status: 'pending' });
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

// ─── ActivityGroup component ──────────────────────────────────────────────

function ActivityGroup({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const { toolCalls, thoughts } = useMemo(() => parseActivityMessages(messages), [messages]);

  const completedCount = toolCalls.filter((tc) => tc.status === 'completed').length;
  const failedCount = toolCalls.filter((tc) => tc.status === 'failed').length;
  const pendingCount = toolCalls.filter((tc) => tc.status === 'pending').length;

  const parts: string[] = [];
  if (toolCalls.length > 0) parts.push(`${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`);
  if (thoughts.length > 0) parts.push(`${thoughts.length} thought${thoughts.length !== 1 ? 's' : ''}`);
  const label = parts.join(', ');

  let statusSuffix = '';
  if (toolCalls.length > 0 && pendingCount === 0) {
    if (failedCount === 0) {
      statusSuffix = ' · all passed';
    } else {
      const sp: string[] = [];
      if (completedCount > 0) sp.push(`${completedCount} passed`);
      if (failedCount > 0) sp.push(`${failedCount} failed`);
      statusSuffix = ` · ${sp.join(', ')}`;
    }
  }

  const borderColor = failedCount > 0 ? 'border-red-400/50' : 'border-muted';

  return (
    <div
      className={`border-l-2 ${borderColor} pl-3 my-1 cursor-pointer select-none`}
      onClick={() => setExpanded((e) => !e)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      <div className="flex items-center gap-1 text-sm text-muted-foreground min-h-[44px]">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span>
          {label}
          {statusSuffix && (
            <span className={failedCount > 0 ? 'text-red-400' : 'text-emerald-500'}>{statusSuffix}</span>
          )}
        </span>
      </div>
      {expanded && (
        <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
          {toolCalls.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
              {tc.status === 'completed' && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
              {tc.status === 'failed' && <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
              {tc.status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
              <span className="font-mono truncate">{shortenToolLabel(tc.label)}</span>
            </div>
          ))}
          {thoughts.length > 0 && (
            <div className="mt-1.5 space-y-1 border-t border-muted/50 pt-1.5">
              {thoughts.map((m) => (
                <div key={m.id} className="text-xs text-muted-foreground/70 whitespace-pre-wrap break-words pl-5">
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ChatBubble component ──────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const { role, content, eventType } = message;

  if (role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground italic px-3 py-1">{content}</span>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  if (eventType === 'input_request') {
    return (
      <div className="flex justify-start my-2">
        <div className="max-w-[85%] rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  );
}

// ─── Session state helpers ──────────────────────────────────────────────────

const SESSION_STATE_DOT: Record<AgentSessionState, string> = {
  starting: 'bg-blue-500',
  ready: 'bg-cyan-500',
  running: 'bg-green-500',
  stopped: 'bg-zinc-400',
  crashed: 'bg-red-500',
  interrupted: 'bg-amber-500',
};

function isSessionActive(state: AgentSessionState): boolean {
  return state === 'running' || state === 'ready' || state === 'starting';
}

function isSessionTerminal(state: AgentSessionState): boolean {
  return state === 'stopped' || state === 'crashed' || state === 'interrupted';
}

// ─── Session tab bar ────────────────────────────────────────────────────────

function SessionTabs({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  newDisabled,
}: {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  newDisabled: boolean;
}) {
  // Count per agent type to generate tab labels
  const labels = useMemo(() => {
    const counts: Record<string, number> = {};
    return sessions.map((s) => {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      const shortName = s.agent_type === 'claude-code' ? 'Claude' : s.agent_type;
      return `${shortName} ${counts[s.agent_type]}`;
    });
  }, [sessions]);

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto">
      {sessions.map((session, i) => {
        const isActive = session.id === activeSessionId;
        const dotColor = SESSION_STATE_DOT[session.state];
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap min-h-[36px] transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${dotColor} shrink-0`} />
            {labels[i]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        disabled={newDisabled}
        className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent/50 disabled:opacity-50 shrink-0"
        aria-label="New session"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');
  const [turnInFlight, setTurnInFlight] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const taskId = id ?? '';

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: task, isLoading, error } = useQuery(taskDetailQuery(taskId));
  const { data: sessions = [] } = useQuery(taskSessionsQuery(taskId));

  // Auto-select first session or latest session
  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      // Select the last session (most recently created)
      setActiveSessionId(sessions[sessions.length - 1].id);
    }
    // If activeSessionId no longer exists in sessions, reset
    if (activeSessionId && sessions.length > 0 && !sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(sessions[sessions.length - 1].id);
    }
  }, [sessions, activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // ── Per-session chat history from server ──────────────────────────────
  const { data: sessionChatHistory } = useQuery(
    sessionChatQuery(activeSessionId ?? '', 500),
  );

  // ── Store selectors (keyed by sessionId) ──────────────────────────────
  const chatMessages = useWsStore((s) =>
    activeSessionId ? (s.chatMessages[activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const setChatMessages = useWsStore((s) => s.setChatMessages);
  const appendChatMessage = useWsStore((s) => s.appendChatMessage);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const removePendingInput = useWsStore((s) => s.removePendingInput);
  const agentActivity = useWsStore((s) =>
    activeSessionId ? (s.agentActivity[activeSessionId] ?? null) : null
  );

  const pendingInputs = useMemo(
    () => activeSessionId
      ? allPendingInputs.filter((p) => p.sessionId === activeSessionId)
      : [],
    [allPendingInputs, activeSessionId],
  );

  // ── Seed store from server chat history ───────────────────────────────
  useEffect(() => {
    if (activeSessionId && sessionChatHistory && sessionChatHistory.length > 0) {
      setChatMessages(activeSessionId, sessionChatHistory);
    }
  }, [sessionChatHistory, activeSessionId, setChatMessages]);

  // ── Clear turn-in-flight when agent responds ──────────────────────────
  useEffect(() => {
    if (!turnInFlight) return;
    const last = chatMessages[chatMessages.length - 1];
    if (last && last.role !== 'user') {
      setTurnInFlight(false);
    }
  }, [chatMessages, turnInFlight]);

  // Clear turn-in-flight when session stops
  const sessionState = activeSession?.state;
  useEffect(() => {
    if (sessionState && isSessionTerminal(sessionState)) setTurnInFlight(false);
  }, [sessionState]);

  // ── Auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, agentActivity]);

  // ── Grouped items ─────────────────────────────────────────────────────
  const groupedItems = useMemo(() => groupMessages(chatMessages), [chatMessages]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: () => api.createSession(taskId),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      // Pre-fill with task description for the first session
      if (sessions.length === 0 && task?.description) {
        setInputText(task.description);
      }
      qc.invalidateQueries({ queryKey: sessionKeys.forTask(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Session created' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to create session', description: err.message, variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) => api.stopSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTask(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Stop signal sent' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to stop session', description: err.message, variant: 'destructive' });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => api.resumeSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.forTask(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Session resumed' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to resume session', description: err.message, variant: 'destructive' });
    },
  });

  const markDoneMutation = useMutation({
    mutationFn: () => api.updateTask(taskId, { status: 'done' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.byProject() });
      showToast({ title: 'Task marked as done' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to mark task done', description: err.message, variant: 'destructive' });
    },
  });

  // ── Send handler ──────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !activeSessionId) return;

    if (pendingInputs.length > 0) {
      const pi = pendingInputs[0];
      sendClientEvent({ type: 'send_input', taskId, inputId: pi.inputId, response: text });
      removePendingInput(pi.inputId);
    } else {
      sendClientEvent({ type: 'send_message', sessionId: activeSessionId, content: text });
    }

    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      eventType: pendingInputs.length > 0 ? 'input_response' : 'prompt',
      timestamp: new Date().toISOString(),
    };
    appendChatMessage(activeSessionId, optimisticMsg);
    setInputText('');
    setTurnInFlight(true);
  }, [inputText, pendingInputs, taskId, activeSessionId, removePendingInput, appendChatMessage]);

  // ── Derived state ─────────────────────────────────────────────────────
  const isDone = task?.status === 'done';
  const hasSessions = sessions.length > 0;
  const hasActiveSessions = sessions.some(s => isSessionActive(s.state));
  const activeSessionRunning = activeSession && isSessionActive(activeSession.state);
  const activeSessionStopped = activeSession && isSessionTerminal(activeSession.state);
  const activeSessionReady = activeSession?.state === 'ready';
  const actionLoading = createSessionMutation.isPending || stopMutation.isPending || resumeMutation.isPending;

  // Input bar state
  const canType = activeSessionRunning && !turnInFlight && !isDone;
  const inputPlaceholder = useMemo(() => {
    if (isDone) return 'Task completed';
    if (!activeSession) return 'Create a session to begin...';
    if (activeSessionStopped) return 'Session ended';
    if (activeSessionReady) return 'Send your first message...';
    if (turnInFlight) return 'Agent is working...';
    if (pendingInputs.length > 0) return pendingInputs[0].question;
    return 'Send a message...';
  }, [isDone, activeSession, activeSessionStopped, activeSessionReady, turnInFlight, pendingInputs]);

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100dvh-3rem)]">
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-6 w-1/3 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="p-4 space-y-4">
          <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
          <div className="h-20 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex flex-col h-[calc(100dvh-3rem)]">
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-4 text-center">
          <p className="text-destructive">{error instanceof Error ? error.message : 'Task not found'}</p>
          <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)]">
      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
        <StatusBadge status={task.status} />
        {/* Stop active session button */}
        {activeSessionRunning && (
          <Button
            size="icon"
            variant="destructive"
            aria-label="Stop session"
            onClick={() => activeSessionId && stopMutation.mutate(activeSessionId)}
            disabled={actionLoading}
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
        {/* Mark done button — visible when no active sessions and not already done */}
        {!isDone && !hasActiveSessions && hasSessions && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => markDoneMutation.mutate()}
            disabled={markDoneMutation.isPending}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            Done
          </Button>
        )}
      </div>

      {/* ── Session tabs ───────────────────────────────────────────────── */}
      {hasSessions && (
        <SessionTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onNew={() => createSessionMutation.mutate()}
          newDisabled={isDone || actionLoading}
        />
      )}

      {/* ── Chat area (scrollable) ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* No sessions yet — empty state */}
        {!hasSessions && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-muted-foreground text-sm text-center">
              {isDone ? 'This task is done.' : 'No sessions yet. Start one to begin working.'}
            </p>
            {!isDone && (
              <Button
                onClick={() => createSessionMutation.mutate()}
                disabled={actionLoading}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {createSessionMutation.isPending ? 'Starting...' : 'Start a session'}
              </Button>
            )}
          </div>
        )}

        {/* Session selected but no messages */}
        {hasSessions && groupedItems.length === 0 && activeSession && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              {activeSessionReady
                ? 'Session ready. Send your first message.'
                : isSessionActive(activeSession.state)
                  ? 'Waiting for agent output...'
                  : 'No messages in this session.'}
            </p>
          </div>
        )}

        {/* Chat messages */}
        {groupedItems.map((item) => {
          if (item.kind === 'activity-group') {
            return <ActivityGroup key={`ag-${item.messages[0].id}`} messages={item.messages} />;
          }
          return <ChatBubble key={item.message.id} message={item.message} />;
        })}

        {/* Agent activity indicator */}
        {agentActivity && activeSessionRunning && (
          <div className="flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
            </span>
            <span className="truncate">{agentActivity}</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Sticky input bar ───────────────────────────────────────────── */}
      {hasSessions && activeSession && (
        <div className="sticky bottom-0 z-40 bg-background border-t px-4 py-3">
          {/* Stopped/crashed session → resume button */}
          {activeSessionStopped && !isDone ? (
            <Button
              className="w-full gap-2"
              onClick={() => activeSessionId && resumeMutation.mutate(activeSessionId)}
              disabled={actionLoading}
            >
              <RotateCcw className="h-4 w-4" />
              {resumeMutation.isPending ? 'Resuming...' : 'Resume Session'}
            </Button>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={inputPlaceholder}
                disabled={!canType && !activeSessionReady}
                className="flex-1 min-h-[44px]"
              />
              <Button
                type="submit"
                size="icon"
                disabled={(!canType && !activeSessionReady) || !inputText.trim()}
                className="min-h-[44px] min-w-[44px]"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

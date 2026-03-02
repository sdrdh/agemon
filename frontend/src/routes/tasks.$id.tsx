import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Square, Send, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/custom/status-badge';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { sendClientEvent } from '@/lib/ws';
import { taskDetailQuery, taskKeys, taskChatQuery } from '@/lib/query';
import { useWsStore } from '@/lib/store';
import type { ChatMessage } from '@agemon/shared';

// Stable empty array reference to prevent re-renders
const EMPTY_MESSAGES: ChatMessage[] = [];

// ─── Types for grouped chat items ──────────────────────────────────────────

interface ChatBubbleItem {
  kind: 'bubble';
  message: ChatMessage;
}

interface ThoughtGroupItem {
  kind: 'thought-group';
  messages: ChatMessage[];
}

type ChatItem = ChatBubbleItem | ThoughtGroupItem;

// ─── Grouping logic ────────────────────────────────────────────────────────

function groupMessages(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let currentThoughts: ChatMessage[] = [];

  function flushThoughts() {
    if (currentThoughts.length > 0) {
      items.push({ kind: 'thought-group', messages: [...currentThoughts] });
      currentThoughts = [];
    }
  }

  for (const msg of messages) {
    if (msg.eventType === 'thought' && msg.role === 'agent') {
      currentThoughts.push(msg);
    } else {
      flushThoughts();
      items.push({ kind: 'bubble', message: msg });
    }
  }
  flushThoughts();

  return items;
}

// ─── ThoughtGroup component ────────────────────────────────────────────────

function ThoughtGroup({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-l-2 border-muted pl-3 my-1 cursor-pointer select-none"
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
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <span>{messages.length} agent thought{messages.length !== 1 ? 's' : ''}</span>
      </div>
      {expanded && (
        <div className="space-y-1 pb-2" onClick={(e) => e.stopPropagation()}>
          {messages.map((m) => (
            <div key={m.id} className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
              {m.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ChatBubble component ──────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const { role, content, eventType } = message;

  // System messages: centered, small, muted
  if (role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground italic px-3 py-1">{content}</span>
      </div>
    );
  }

  // User messages: right-aligned, primary background
  if (role === 'user') {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  // Agent messages
  // Input request: amber styling
  if (eventType === 'input_request') {
    return (
      <div className="flex justify-start my-2">
        <div className="max-w-[85%] rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  // Default agent (action, etc.): left-aligned, muted background
  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
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

  const taskId = id ?? '';

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: task, isLoading, error } = useQuery(taskDetailQuery(taskId));
  const { data: chatHistory } = useQuery(taskChatQuery(taskId));

  // ── Store selectors (stable) ──────────────────────────────────────────
  const chatMessages = useWsStore((s) => s.chatMessages[taskId] ?? EMPTY_MESSAGES);
  const setChatMessages = useWsStore((s) => s.setChatMessages);
  const appendChatMessage = useWsStore((s) => s.appendChatMessage);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const removePendingInput = useWsStore((s) => s.removePendingInput);

  const pendingInputs = useMemo(
    () => allPendingInputs.filter((p) => p.taskId === taskId),
    [allPendingInputs, taskId],
  );

  // ── Seed store from query data ────────────────────────────────────────
  useEffect(() => {
    if (chatHistory && chatHistory.length > 0) {
      setChatMessages(taskId, chatHistory);
    }
  }, [chatHistory, taskId, setChatMessages]);

  // ── Auto-scroll on new messages ───────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // ── Grouped items (memoized) ──────────────────────────────────────────
  const groupedItems = useMemo(() => groupMessages(chatMessages), [chatMessages]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: () => api.startTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Agent started' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to start agent', description: err.message, variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      showToast({ title: 'Stop signal sent' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to stop agent', description: err.message, variant: 'destructive' });
    },
  });

  // ── Send handler ──────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    if (pendingInputs.length > 0) {
      // Answer the first pending question
      const pi = pendingInputs[0];
      sendClientEvent({ type: 'send_input', taskId, inputId: pi.inputId, response: text });
      removePendingInput(pi.inputId);
    } else {
      // New prompt turn
      sendClientEvent({ type: 'send_message', taskId, content: text });
    }

    // Optimistically append user message to chat
    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      eventType: pendingInputs.length > 0 ? 'input_response' : 'prompt',
      timestamp: new Date().toISOString(),
    };
    appendChatMessage(taskId, optimisticMsg);
    setInputText('');
  }, [inputText, pendingInputs, taskId, removePendingInput, appendChatMessage]);

  // ── Derived state ─────────────────────────────────────────────────────
  const isRunning = task?.status === 'working';
  const isAwaiting = task?.status === 'awaiting_input';
  const isDone = task?.status === 'done';
  const isTodo = task?.status === 'todo';
  const actionLoading = startMutation.isPending || stopMutation.isPending;

  // Determine input bar state
  const inputDisabled = isDone || isTodo;
  const inputPlaceholder = useMemo(() => {
    if (isTodo) return 'Start agent to begin...';
    if (isDone) return 'Task completed';
    if (isAwaiting && pendingInputs.length > 0) return pendingInputs[0].question;
    if (isRunning) return 'Send a message...';
    return 'Send a message...';
  }, [isTodo, isDone, isAwaiting, isRunning, pendingInputs]);

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-dvh">
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

  // ── Error state ───────────────────────────────────────────────────────
  if (error || !task) {
    return (
      <div className="flex flex-col h-dvh">
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
    <div className="flex flex-col h-dvh">
      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
        <StatusBadge status={task.status} />
        {(isRunning || isAwaiting) && (
          <Button
            size="icon"
            variant="destructive"
            aria-label="Stop agent"
            onClick={() => stopMutation.mutate()}
            disabled={actionLoading}
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Chat area (scrollable) ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groupedItems.length === 0 && !isRunning && !isAwaiting && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              {isTodo ? 'Start the agent to begin.' : 'No messages yet.'}
            </p>
          </div>
        )}

        {groupedItems.length === 0 && (isRunning || isAwaiting) && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">Waiting for agent output...</p>
          </div>
        )}

        {groupedItems.map((item) => {
          if (item.kind === 'thought-group') {
            return <ThoughtGroup key={`tg-${item.messages[0].id}`} messages={item.messages} />;
          }
          return <ChatBubble key={item.message.id} message={item.message} />;
        })}

        <div ref={chatEndRef} />
      </div>

      {/* ── Sticky input bar ───────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-40 bg-background border-t px-4 py-3">
        {isTodo ? (
          <Button
            className="w-full gap-2"
            onClick={() => startMutation.mutate()}
            disabled={actionLoading}
          >
            <Play className="h-4 w-4" />
            {startMutation.isPending ? 'Starting...' : 'Start Agent'}
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
              disabled={inputDisabled}
              className="flex-1 min-h-[44px]"
            />
            <Button
              type="submit"
              size="icon"
              disabled={inputDisabled || !inputText.trim()}
              className="min-h-[44px] min-w-[44px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

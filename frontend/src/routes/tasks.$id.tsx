import { useRef, useEffect, useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Send, ChevronRight, ChevronDown, Check, X, Loader2, RotateCcw, CheckCircle2, Info, GitFork, Clock, Bot, Archive, Brain, Wrench, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/custom/status-badge';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { sendClientEvent } from '@/lib/ws';
import { taskDetailQuery, taskKeys, taskSessionsQuery, sessionChatQuery, sessionKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApprovalCard } from '@/components/custom/approval-card';
import type { ChatMessage, AgentSession, AgentSessionState, Task, ApprovalDecision, PendingApproval } from '@agemon/shared';

// Stable empty array reference to prevent re-renders
const EMPTY_MESSAGES: ChatMessage[] = [];

// ─── useIsDesktop hook ──────────────────────────────────────────────────────

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeToMediaQuery(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getIsDesktopServer() {
  return false;
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeToMediaQuery, getIsDesktop, getIsDesktopServer);
}

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
  kind: 'tool' | 'skill';
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

// ─── ActivityGroup component ──────────────────────────────────────────────

function ActivityGroup({ messages, isLast }: { messages: ChatMessage[]; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { toolCalls, thoughts } = useMemo(() => {
    const result = parseActivityMessages(messages);
    // If this group is not the last item in the chat, all tools must have completed
    if (!isLast) {
      for (const tc of result.toolCalls) {
        if (tc.status === 'pending') tc.status = 'completed';
      }
    }
    return result;
  }, [messages, isLast]);

  const toolCount = toolCalls.filter((tc) => tc.kind === 'tool').length;
  const skillCount = toolCalls.filter((tc) => tc.kind === 'skill').length;
  const completedCount = toolCalls.filter((tc) => tc.status === 'completed').length;
  const failedCount = toolCalls.filter((tc) => tc.status === 'failed').length;
  const pendingCount = toolCalls.filter((tc) => tc.status === 'pending').length;

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
      {/* Collapsed summary with activity-type icons */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-h-[44px]">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="flex items-center gap-2 flex-wrap">
          {toolCount > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3 shrink-0" />
              <span>{toolCount} tool{toolCount !== 1 ? 's' : ''}</span>
            </span>
          )}
          {skillCount > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <Zap className="h-3 w-3 shrink-0" />
              <span>{skillCount} skill{skillCount !== 1 ? 's' : ''}</span>
            </span>
          )}
          {thoughts.length > 0 && (
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3 shrink-0" />
              <span>{thoughts.length} thought{thoughts.length !== 1 ? 's' : ''}</span>
            </span>
          )}
          {statusSuffix && (
            <span className={failedCount > 0 ? 'text-red-400' : 'text-emerald-500'}>{statusSuffix}</span>
          )}
        </div>
      </div>

      {/* Expanded detail view */}
      {expanded && (
        <div className="space-y-0.5 pb-2" onClick={(e) => e.stopPropagation()}>
          {toolCalls.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
              {tc.kind === 'skill' ? (
                <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <Wrench className="h-3.5 w-3.5 shrink-0 opacity-50" />
              )}
              {tc.status === 'completed' && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
              {tc.status === 'failed' && <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
              {tc.status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
              <span className="font-mono truncate">{shortenToolLabel(tc.label)}</span>
            </div>
          ))}
          {thoughts.length > 0 && (
            <div className="mt-1.5 space-y-1 border-t border-muted/50 pt-1.5">
              {thoughts.map((m) => (
                <div key={m.id} className="flex items-start gap-1.5 text-xs text-muted-foreground/70 break-words">
                  <Brain className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-50" />
                  <span className="whitespace-pre-wrap">{m.content}</span>
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

function ChatBubble({ message, approvalLookup, onApprovalDecision }: {
  message: ChatMessage;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  const { role, content, eventType } = message;

  // Render inline approval card for approval_request markers
  if (eventType === 'approval_request' && approvalLookup && onApprovalDecision) {
    const approval = approvalLookup.get(content);
    if (approval) {
      return <ApprovalCard approval={approval} onDecision={onApprovalDecision} />;
    }
    return null;
  }

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
        <div className="max-w-[85%] rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
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

const SESSION_STATE_LABEL: Record<AgentSessionState, string> = {
  starting: 'Starting',
  ready: 'Ready',
  running: 'Running',
  stopped: 'Stopped',
  crashed: 'Crashed',
  interrupted: 'Interrupted',
};

function isSessionActive(state: AgentSessionState): boolean {
  return state === 'running' || state === 'ready' || state === 'starting';
}

function isSessionTerminal(state: AgentSessionState): boolean {
  return state === 'stopped' || state === 'crashed' || state === 'interrupted';
}

// ─── Task info drawer ────────────────────────────────────────────────────────

function TaskInfoDrawer({
  task,
  sessionCount,
  open,
  onClose,
}: {
  task: Task;
  sessionCount: number;
  open: boolean;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const created = new Date(task.created_at);
  const formattedDate = created.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[85vw] max-w-sm bg-background border-l shadow-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Task details"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-foreground">Task Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent/50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-49px)] px-4 py-4 space-y-5">
          {/* Description */}
          {task.description && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </section>
          )}

          {/* Repos */}
          {task.repos.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Repositories</h3>
              <div className="space-y-1.5">
                {task.repos.map((repo) => (
                  <div key={repo.id} className="flex items-center gap-2 text-sm">
                    <GitFork className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs truncate">{repo.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Metadata grid */}
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Info</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Agent</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <AgentIcon agentType={task.agent} className={`h-3.5 w-3.5 ${AGENT_COLORS[task.agent] ?? ''}`} />
                  <span className="text-xs">{agentDisplayName(task.agent)}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto text-xs">{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Sessions</span>
                <span className="ml-auto text-xs">{sessionCount}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="h-3.5 w-3.5 shrink-0" />
                <span className="text-muted-foreground">Task ID</span>
                <span className="ml-auto font-mono text-xs truncate max-w-[140px]">{task.id}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Session list panel ──────────────────────────────────────────────────────

function SessionListPanel({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onStop,
  onResume,
  onMarkDone,
  newDisabled,
  isDone,
  hasActiveSessions,
  actionLoading,
  unreadSessions,
  pendingInputSessionIds,
  sessionLabels,
}: {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onMarkDone: () => void;
  newDisabled: boolean;
  isDone: boolean;
  hasActiveSessions: boolean;
  actionLoading: boolean;
  unreadSessions: Record<string, boolean>;
  pendingInputSessionIds: Set<string>;
  sessionLabels: string[];
}) {
  return (
    <div className="flex flex-col w-full lg:w-[280px] lg:min-w-[280px] lg:border-r overflow-y-auto bg-background">
      {/* Session cards */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 px-4">
            <p className="text-muted-foreground text-sm text-center">
              {isDone ? 'This task is done.' : 'No sessions yet. Start one to begin working.'}
            </p>
            {!isDone && (
              <Button
                onClick={onNew}
                disabled={actionLoading}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {actionLoading ? 'Starting...' : 'Start a session'}
              </Button>
            )}
          </div>
        )}

        {(() => {
          // Build a label lookup by session ID
          const labelMap = new Map<string, string>();
          sessions.forEach((s, i) => { labelMap.set(s.id, sessionLabels[i]); });

          const activeSessions = sessions.filter(s => isSessionActive(s.state));
          const previousSessions = sessions.filter(s => isSessionTerminal(s.state));

          const renderSession = (session: AgentSession) => {
            const label = labelMap.get(session.id) ?? '';
            const isActiveItem = session.id === activeSessionId;
            const dotColor = SESSION_STATE_DOT[session.state];
            const stateLabel = SESSION_STATE_LABEL[session.state];
            const hasUnread = !isActiveItem && unreadSessions[session.id];
            const needsAttention = !isActiveItem && pendingInputSessionIds.has(session.id);
            const canStop = isSessionActive(session.state);
            const canResume = isSessionTerminal(session.state) && !isDone;

            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                className={`relative w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left transition-colors border-b ${
                  isActiveItem
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'hover:bg-accent/50 border-l-2 border-l-transparent'
                }`}
              >
                {/* Agent icon with state dot overlay */}
                <span className="relative shrink-0">
                  <AgentIcon agentType={session.agent_type} className={`h-5 w-5 ${AGENT_COLORS[session.agent_type] ?? 'text-muted-foreground'}`} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ${dotColor} ring-1 ring-background`} />
                </span>

                {/* Label + state */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{label}</div>
                  <div className="text-xs text-muted-foreground">{stateLabel}</div>
                </div>

                {/* Unread indicators */}
                {needsAttention && (
                  <span className="flex h-2.5 w-2.5 shrink-0" role="status">
                    <span className="sr-only">Awaiting input</span>
                    <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-amber-400/75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                  </span>
                )}
                {hasUnread && !needsAttention && (
                  <span className="flex h-2 w-2 shrink-0" role="status">
                    <span className="sr-only">New activity</span>
                    <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-primary/60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}

                {/* Inline action button */}
                {canStop && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    aria-label={`Archive ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStop(session.id);
                    }}
                    disabled={actionLoading}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canResume && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 shrink-0 text-primary hover:bg-primary/10"
                    aria-label={`Resume ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onResume(session.id);
                    }}
                    disabled={actionLoading}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </button>
            );
          };

          return (
            <>
              {activeSessions.length > 0 && (
                <>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-2">Active</div>
                  {activeSessions.map(renderSession)}
                </>
              )}
              {previousSessions.length > 0 && (
                <>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-2">Previous</div>
                  {previousSessions.map(renderSession)}
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* Bottom actions */}
      {sessions.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2 bg-background">
          {!isDone && (
            <Button
              variant="outline"
              className="w-full gap-2 min-h-[44px]"
              onClick={onNew}
              disabled={newDisabled}
            >
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          )}
          {!isDone && !hasActiveSessions && sessions.length > 0 && (
            <Button
              variant="outline"
              className="w-full gap-2 min-h-[44px]"
              onClick={onMarkDone}
              disabled={actionLoading}
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Done
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Session chat panel ──────────────────────────────────────────────────────

function SessionChatPanel({
  session,
  sessionLabel,
  groupedItems,
  agentActivity,
  pendingInputs,
  pendingApprovals,
  onApprovalDecision,
  inputText,
  setInputText,
  handleSend,
  turnInFlight,
  isDone,
  actionLoading,
  onStop,
  onResume,
  onBack,
  isDesktop,
  chatEndRef,
}: {
  session: AgentSession;
  sessionLabel: string;
  groupedItems: ChatItem[];
  agentActivity: string | null;
  pendingInputs: { inputId: string; question: string }[];
  pendingApprovals: PendingApproval[];
  onApprovalDecision: (approvalId: string, decision: ApprovalDecision) => void;
  inputText: string;
  setInputText: (text: string) => void;
  handleSend: () => void;
  turnInFlight: boolean;
  isDone: boolean;
  actionLoading: boolean;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onBack: () => void;
  isDesktop: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  const sessionRunning = isSessionActive(session.state);
  const sessionStopped = isSessionTerminal(session.state);
  const sessionReady = session.state === 'ready';
  const canType = sessionRunning && !turnInFlight && !isDone;

  // Build approval lookup map for inline rendering
  const approvalLookup = useMemo(() => {
    const map = new Map<string, PendingApproval>();
    for (const a of pendingApprovals) map.set(a.id, a);
    return map;
  }, [pendingApprovals]);

  const inputPlaceholder = useMemo(() => {
    if (isDone) return 'Task completed';
    if (sessionStopped) return 'Session ended';
    if (sessionReady) return 'Send your first message...';
    if (turnInFlight) return 'Agent is working...';
    if (pendingInputs.length > 0) return pendingInputs[0].question;
    return 'Send a message...';
  }, [isDone, sessionStopped, sessionReady, turnInFlight, pendingInputs]);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Mobile chat header with back button */}
      {!isDesktop && (
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button size="icon" variant="ghost" aria-label="Back to sessions" onClick={onBack} className="min-h-[44px] min-w-[44px]">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${SESSION_STATE_DOT[session.state]} shrink-0`} />
          <span className="text-sm font-medium flex-1 truncate">{sessionLabel}</span>
          {sessionRunning && (
            <Button
              size="sm"
              variant="outline"
              aria-label="Archive session"
              onClick={() => onStop(session.id)}
              disabled={actionLoading}
              className="gap-1.5"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </Button>
          )}
        </div>
      )}

      {/* Chat area (scrollable) */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Session selected but no messages */}
        {groupedItems.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              {sessionReady
                ? 'Session ready. Send your first message.'
                : isSessionActive(session.state)
                  ? 'Waiting for agent output...'
                  : 'No messages in this session.'}
            </p>
          </div>
        )}

        {/* Chat messages (approvals render inline via approval_request markers) */}
        {groupedItems.map((item, idx) => {
          if (item.kind === 'activity-group') {
            return <ActivityGroup key={`ag-${item.messages[0].id}`} messages={item.messages} isLast={idx === groupedItems.length - 1} />;
          }
          return (
            <ChatBubble
              key={item.message.id}
              message={item.message}
              approvalLookup={approvalLookup}
              onApprovalDecision={onApprovalDecision}
            />
          );
        })}

        {/* Agent activity indicator */}
        {agentActivity && sessionRunning && !agentActivity.startsWith('Waiting for approval') && (
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

      {/* Sticky input bar */}
      <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background">
        {/* Stopped/crashed session -> resume button */}
        {sessionStopped && !isDone ? (
          <Button
            className="w-full gap-2 min-h-[44px]"
            onClick={() => onResume(session.id)}
            disabled={actionLoading}
          >
            <RotateCcw className="h-4 w-4" />
            {actionLoading ? 'Resuming...' : 'Resume Session'}
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
              disabled={!canType && !sessionReady}
              className="flex-1 min-h-[44px]"
            />
            <Button
              type="submit"
              size="icon"
              disabled={(!canType && !sessionReady) || !inputText.trim()}
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

// ─── Main component ────────────────────────────────────────────────────────

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');
  const [turnInFlight, setTurnInFlight] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const taskId = id ?? '';

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: task, isLoading, error } = useQuery(taskDetailQuery(taskId));
  const { data: sessions = [] } = useQuery(taskSessionsQuery(taskId));

  // ── Session labels ────────────────────────────────────────────────────
  const sessionLabels = useMemo(() => {
    const counts: Record<string, number> = {};
    return sessions.map((s) => {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1;
      if (s.name) return s.name;
      const shortName = agentDisplayName(s.agent_type);
      return `${shortName} ${counts[s.agent_type]}`;
    });
  }, [sessions]);

  // ── Auto-select logic (desktop only) ──────────────────────────────────
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    // On desktop, auto-select the latest session if none selected
    if (isDesktop && !selectedSessionId) {
      setSelectedSessionId(sessions[sessions.length - 1].id);
    }
    // If selected session no longer exists, reset
    if (selectedSessionId && !sessions.find(s => s.id === selectedSessionId)) {
      if (isDesktop) {
        setSelectedSessionId(sessions[sessions.length - 1].id);
      } else {
        setSelectedSessionId(null);
      }
    }
  }, [sessions, selectedSessionId, isDesktop]);

  const activeSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const activeSessionLabel = useMemo(() => {
    const idx = sessions.findIndex(s => s.id === selectedSessionId);
    return idx >= 0 ? sessionLabels[idx] : '';
  }, [sessions, selectedSessionId, sessionLabels]);

  // ── Per-session chat history from server ──────────────────────────────
  const { data: sessionChatHistory } = useQuery(
    sessionChatQuery(selectedSessionId ?? '', 500),
  );

  // ── Store selectors (keyed by sessionId) ──────────────────────────────
  const chatMessages = useWsStore((s) =>
    selectedSessionId ? (s.chatMessages[selectedSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const setChatMessages = useWsStore((s) => s.setChatMessages);
  const appendChatMessage = useWsStore((s) => s.appendChatMessage);
  const allPendingInputs = useWsStore((s) => s.pendingInputs);
  const removePendingInput = useWsStore((s) => s.removePendingInput);
  const agentActivity = useWsStore((s) =>
    selectedSessionId ? (s.agentActivity[selectedSessionId] ?? null) : null
  );
  const unreadSessions = useWsStore((s) => s.unreadSessions);
  const clearUnread = useWsStore((s) => s.clearUnread);

  const pendingInputs = useMemo(
    () => selectedSessionId
      ? allPendingInputs.filter((p) => p.sessionId === selectedSessionId)
      : [],
    [allPendingInputs, selectedSessionId],
  );

  // ── Approval state ──────────────────────────────────────────────────
  const allPendingApprovals = useWsStore((s) => s.pendingApprovals);
  const setPendingApprovals = useWsStore((s) => s.setPendingApprovals);
  const sessionApprovals = useMemo(
    () => selectedSessionId
      ? allPendingApprovals.filter((a) => a.sessionId === selectedSessionId)
      : [],
    [allPendingApprovals, selectedSessionId],
  );

  // Hydrate pending approvals on task load (for reconnect)
  useEffect(() => {
    if (!taskId) return;
    fetch(`/api/tasks/${taskId}/approvals`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('agemon_key') ?? ''}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((approvals: PendingApproval[]) => {
        if (approvals.length > 0) {
          setPendingApprovals(approvals);
        }
      })
      .catch(() => { /* ignore — approvals will arrive via WS */ });
  }, [taskId, setPendingApprovals]);

  // ── Clear unread for the active session ─────────────────────────────
  useEffect(() => {
    if (selectedSessionId) clearUnread(selectedSessionId);
  }, [selectedSessionId, chatMessages, clearUnread]);

  // Derive set of session IDs with pending inputs (for priority indicator)
  const pendingInputSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allPendingInputs) ids.add(p.sessionId);
    return ids;
  }, [allPendingInputs]);

  // ── Seed store from server chat history ───────────────────────────────
  useEffect(() => {
    if (selectedSessionId && sessionChatHistory && sessionChatHistory.length > 0) {
      setChatMessages(selectedSessionId, sessionChatHistory);
    }
  }, [sessionChatHistory, selectedSessionId, setChatMessages]);

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
      setSelectedSessionId(session.id);
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
    if (!text || !selectedSessionId) return;

    if (pendingInputs.length > 0) {
      const pi = pendingInputs[0];
      sendClientEvent({ type: 'send_input', taskId, inputId: pi.inputId, response: text });
      removePendingInput(pi.inputId);
    } else {
      sendClientEvent({ type: 'send_message', sessionId: selectedSessionId, content: text });
    }

    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      eventType: pendingInputs.length > 0 ? 'input_response' : 'prompt',
      timestamp: new Date().toISOString(),
    };
    appendChatMessage(selectedSessionId, optimisticMsg);
    setInputText('');
    setTurnInFlight(true);
  }, [inputText, pendingInputs, taskId, selectedSessionId, removePendingInput, appendChatMessage]);

  // ── Approval decision handler ────────────────────────────────────────
  const handleApprovalDecision = useCallback((approvalId: string, decision: ApprovalDecision) => {
    sendClientEvent({ type: 'approval_response', approvalId, decision });
  }, []);

  // ── Session selection handler (for mobile navigation) ──────────────────
  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    clearUnread(sessionId);
  }, [clearUnread]);

  const handleBackToList = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────
  const isDone = task?.status === 'done';
  const hasSessions = sessions.length > 0;
  const hasActiveSessions = sessions.some(s => isSessionActive(s.state));
  const actionLoading = createSessionMutation.isPending || stopMutation.isPending || resumeMutation.isPending;

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

  // Determine which panels to show
  const showSessionList = isDesktop || !selectedSessionId;
  const showChatPanel = selectedSessionId && activeSession;

  return (
    <div className="flex flex-col h-dvh">
      {/* ── Sticky header (hidden on mobile when viewing a session chat) ── */}
      {(isDesktop || !selectedSessionId) && (
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
          <Button size="icon" variant="ghost" aria-label="Task info" onClick={() => setInfoOpen(true)}>
            <Info className="h-4 w-4" />
          </Button>
          <StatusBadge status={task.status} />
        </div>
      )}

      {/* ── Main content area ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session list — always visible on desktop, visible on mobile when no session selected */}
        {showSessionList && (
          <SessionListPanel
            sessions={sessions}
            activeSessionId={selectedSessionId}
            onSelect={handleSelectSession}
            onNew={() => createSessionMutation.mutate()}
            onStop={(sid) => stopMutation.mutate(sid)}
            onResume={(sid) => resumeMutation.mutate(sid)}
            onMarkDone={() => markDoneMutation.mutate()}
            newDisabled={isDone || actionLoading}
            isDone={isDone}
            hasActiveSessions={hasActiveSessions}
            actionLoading={actionLoading}
            unreadSessions={unreadSessions}
            pendingInputSessionIds={pendingInputSessionIds}
            sessionLabels={sessionLabels}
          />
        )}

        {/* Chat panel — visible when a session is selected */}
        {showChatPanel && (
          <SessionChatPanel
            session={activeSession}
            sessionLabel={activeSessionLabel}
            groupedItems={groupedItems}
            agentActivity={agentActivity}
            pendingInputs={pendingInputs}
            pendingApprovals={sessionApprovals}
            onApprovalDecision={handleApprovalDecision}
            inputText={inputText}
            setInputText={setInputText}
            handleSend={handleSend}
            turnInFlight={turnInFlight}
            isDone={isDone}
            actionLoading={actionLoading}
            onStop={(sid) => stopMutation.mutate(sid)}
            onResume={(sid) => resumeMutation.mutate(sid)}
            onBack={handleBackToList}
            isDesktop={isDesktop}
            chatEndRef={chatEndRef}
          />
        )}

        {/* Desktop: no session selected placeholder */}
        {isDesktop && hasSessions && !selectedSessionId && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Select a session</p>
          </div>
        )}
      </div>

      {/* ── Info drawer ──────────────────────────────────────────────── */}
      <TaskInfoDrawer
        task={task}
        sessionCount={sessions.length}
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
      />
    </div>
  );
}

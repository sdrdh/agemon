import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { agentDisplayName } from '@/components/custom/agent-icons';
import { TaskInfoDrawer } from '@/components/custom/task-info-drawer';
import { SessionListPanel } from '@/components/custom/session-list-panel';
import { SessionChatPanel } from '@/components/custom/session-chat-panel';
import { groupMessages, isSessionActive, isSessionTerminal } from '@/lib/chat-utils';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { sendClientEvent } from '@/lib/ws';
import { taskDetailQuery, taskKeys, taskSessionsQuery, sessionChatQuery, sessionKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';
import { friendlyError } from '@/lib/errors';
import type { ChatMessage, ApprovalDecision, PendingApproval, AgentType } from '@agemon/shared';

const EMPTY_MESSAGES: ChatMessage[] = [];

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

  // ── Approval state (declared early for auto-select) ────────────────
  const allPendingApprovals = useWsStore((s) => s.pendingApprovals);
  const mergePendingApprovals = useWsStore((s) => s.mergePendingApprovals);

  const taskApprovalSessionId = useMemo(() => {
    const sessionIds = new Set(sessions.map(s => s.id));
    return allPendingApprovals.find(
      a => a.status === 'pending' && a.taskId === taskId && sessionIds.has(a.sessionId)
    )?.sessionId ?? null;
  }, [allPendingApprovals, taskId, sessions]);

  // ── Auto-select logic ───────────────────────────────────────────────
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId) {
      // On desktop: prefer session with a pending approval, then fall back to last session
      // On mobile: only auto-select if there's a pending approval (otherwise stay on session list)
      if (taskApprovalSessionId) {
        setSelectedSessionId(taskApprovalSessionId);
      } else if (isDesktop) {
        setSelectedSessionId(sessions[sessions.length - 1].id);
      }
      return;
    }
    if (!sessions.find(s => s.id === selectedSessionId)) {
      if (isDesktop) {
        setSelectedSessionId(sessions[sessions.length - 1].id);
      } else {
        setSelectedSessionId(null);
      }
    }
  }, [sessions, selectedSessionId, isDesktop, taskApprovalSessionId]);

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

  // ── Session approvals ──────────────────────────────────────────────
  const sessionApprovals = useMemo(
    () => selectedSessionId
      ? allPendingApprovals.filter((a) => a.sessionId === selectedSessionId)
      : [],
    [allPendingApprovals, selectedSessionId],
  );

  useEffect(() => {
    if (!taskId) return;
    fetch(`/api/tasks/${taskId}/approvals?all=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('agemon_key') ?? ''}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((approvals: PendingApproval[]) => {
        mergePendingApprovals(taskId, approvals);
      })
      .catch(() => { /* ignore */ });
  }, [taskId, mergePendingApprovals]);

  // ── Clear unread for the active session ─────────────────────────────
  useEffect(() => {
    if (selectedSessionId) clearUnread(selectedSessionId);
  }, [selectedSessionId, chatMessages, clearUnread]);

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

  const sessionState = activeSession?.state;
  useEffect(() => {
    if (sessionState && isSessionTerminal(sessionState)) setTurnInFlight(false);
  }, [sessionState]);

  // ── Grouped items ─────────────────────────────────────────────────────
  const groupedItems = useMemo(() => groupMessages(chatMessages), [chatMessages]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: (agentType: AgentType) => api.createSession(taskId, { agentType }),
    onSuccess: (session) => {
      setSelectedSessionId(session.id);
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

  const handleApprovalDecision = useCallback((approvalId: string, decision: ApprovalDecision) => {
    sendClientEvent({ type: 'approval_response', approvalId, decision });
  }, []);

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
          <p className="text-destructive">{friendlyError(error, 'Task not found')}</p>
          <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
        </div>
      </div>
    );
  }

  const showSessionList = isDesktop || !selectedSessionId;
  const showChatPanel = selectedSessionId && activeSession;

  return (
    <div className="flex flex-col h-dvh">
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

      <div className="flex flex-1 overflow-hidden">
        {showSessionList && (
          <SessionListPanel
            sessions={sessions}
            activeSessionId={selectedSessionId}
            onSelect={handleSelectSession}
            onNew={(agentType) => createSessionMutation.mutate(agentType)}
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

        {isDesktop && hasSessions && !selectedSessionId && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Select a session</p>
          </div>
        )}
      </div>

      <TaskInfoDrawer
        task={task}
        sessionCount={sessions.length}
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
      />
    </div>
  );
}

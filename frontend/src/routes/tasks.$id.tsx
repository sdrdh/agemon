import { useRef, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { TaskInfoDrawer } from '@/components/custom/task-info-drawer';
import { SessionListPanel } from '@/components/custom/session-list-panel';
import { SessionChatPanel } from '@/components/custom/session-chat-panel';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useTaskDetail } from '@/hooks/use-task-detail';
import { useSessionSelection } from '@/hooks/use-session-selection';
import { useSessionChat } from '@/hooks/use-session-chat';
import { useWsStore } from '@/lib/store';
import { friendlyError } from '@/lib/errors';

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const taskId = id ?? '';

  // ── Custom hooks ──────────────────────────────────────────────────────
  const {
    task,
    sessions,
    isLoading,
    error,
    isDone,
    hasSessions,
    hasActiveSessions,
    actionLoading,
    createSessionMutation,
    stopMutation,
    resumeMutation,
    markDoneMutation,
    archiveTaskMutation,
    archiveSessionMutation,
  } = useTaskDetail(taskId);

  const {
    selectedSessionId,
    setSelectedSessionId,
    activeSession,
    activeSessionLabel,
    sessionLabels,
    handleSelectSession,
    handleBackToList,
  } = useSessionSelection(sessions, isDesktop);

  const {
    groupedItems,
    agentActivity,
    pendingInputs,
    sessionApprovals,
    unreadSessions,
    turnInFlight,
    pendingInputSessionIds,
    handleSend,
    handleCancelTurn,
    handleApprovalDecision,
  } = useSessionChat(taskId, selectedSessionId, activeSession?.state);

  // ── Session usage ─────────────────────────────────────────────────────
  const allSessionUsage = useWsStore((s) => s.sessionUsage);
  const activeSessionUsage = selectedSessionId ? allSessionUsage[selectedSessionId] : undefined;

  // ── Handle new session creation ───────────────────────────────────────
  const handleNewSession = async (agentType: Parameters<typeof createSessionMutation.mutate>[0]) => {
    const result = await createSessionMutation.mutateAsync(agentType);
    setSelectedSessionId(result.id);
    if (sessions.length === 0 && task?.description) {
      setInputText(task.description);
    }
  };

  // ── Send wrapper ──────────────────────────────────────────────────────
  const handleSendAndClear = () => {
    handleSend(inputText);
    setInputText('');
  };

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
            onNew={handleNewSession}
            onStop={(sid) => stopMutation.mutate(sid)}
            onResume={(sid) => resumeMutation.mutate(sid)}
            onMarkDone={() => markDoneMutation.mutate()}
            onArchiveSession={(sid, archived) => archiveSessionMutation.mutate({ sessionId: sid, archived })}
            newDisabled={isDone || actionLoading}
            isDone={isDone}
            hasActiveSessions={hasActiveSessions}
            actionLoading={actionLoading}
            unreadSessions={unreadSessions}
            pendingInputSessionIds={pendingInputSessionIds}
            sessionLabels={sessionLabels}
            sessionUsage={allSessionUsage}
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
            handleSend={handleSendAndClear}
            onCancelTurn={handleCancelTurn}
            turnInFlight={turnInFlight}
            isDone={isDone}
            actionLoading={actionLoading}
            onStop={(sid) => stopMutation.mutate(sid)}
            onResume={(sid) => resumeMutation.mutate(sid)}
            onBack={handleBackToList}
            isDesktop={isDesktop}
            chatEndRef={chatEndRef}
            usage={activeSessionUsage}
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
        onArchive={(archived) => archiveTaskMutation.mutate(archived)}
      />
    </div>
  );
}

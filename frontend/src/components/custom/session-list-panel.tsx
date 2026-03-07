import { useState } from 'react';
import { Plus, RotateCcw, CheckCircle2, Square, Archive } from 'lucide-react';
import { AGENT_TYPES } from '@agemon/shared';
import type { AgentType, AgentSession } from '@agemon/shared';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { SESSION_STATE_DOT, SESSION_STATE_LABEL, isSessionActive, isSessionTerminal } from '@/lib/chat-utils';

function AgentTypeSelector({ value, onValueChange }: { value: AgentType; onValueChange: (v: AgentType) => void }) {
  return (
    <Select value={value} onValueChange={v => onValueChange(v as AgentType)}>
      <SelectTrigger className="h-11 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AGENT_TYPES.map(agent => (
          <SelectItem key={agent} value={agent} className="min-h-[44px]">
            <span className="flex items-center gap-2">
              <AgentIcon agentType={agent} className={`h-4 w-4 ${AGENT_COLORS[agent] ?? 'text-muted-foreground'}`} />
              {agentDisplayName(agent)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SessionListPanel({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onStop,
  onResume,
  onMarkDone,
  onArchiveSession,
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
  onNew: (agentType: AgentType) => void;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onMarkDone: () => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
  newDisabled: boolean;
  isDone: boolean;
  hasActiveSessions: boolean;
  actionLoading: boolean;
  unreadSessions: Record<string, boolean>;
  pendingInputSessionIds: Set<string>;
  sessionLabels: string[];
}) {
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude-code');

  return (
    <div className="flex flex-col w-full lg:w-[280px] lg:min-w-[280px] lg:border-r overflow-y-auto bg-background">
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 px-4">
            <p className="text-muted-foreground text-sm text-center">
              {isDone ? 'This task is done.' : 'No sessions yet. Start one to begin working.'}
            </p>
            {!isDone && (
              <div className="flex gap-2 w-full max-w-[240px]">
                <AgentTypeSelector value={selectedAgent} onValueChange={setSelectedAgent} />
                <Button onClick={() => onNew(selectedAgent)} disabled={actionLoading} className="h-11 px-3 shrink-0">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {(() => {
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
                <span className="relative shrink-0">
                  <AgentIcon agentType={session.agent_type} className={`h-5 w-5 ${AGENT_COLORS[session.agent_type] ?? 'text-muted-foreground'}`} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ${dotColor} ring-1 ring-background`} />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{label}</div>
                  <div className="text-xs text-muted-foreground">{stateLabel}</div>
                </div>

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

                {canStop && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    aria-label={`Stop ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStop(session.id);
                    }}
                    disabled={actionLoading}
                  >
                    <Square className="h-3.5 w-3.5" />
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
                {isSessionTerminal(session.state) && onArchiveSession && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/50 ${session.archived ? 'opacity-50' : ''}`}
                    aria-label={session.archived ? `Unarchive ${label}` : `Archive ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveSession(session.id, !session.archived);
                    }}
                    disabled={actionLoading}
                  >
                    <Archive className="h-3.5 w-3.5" />
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

      {sessions.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2 bg-background">
          {!isDone && (
            <div className="flex gap-2">
              <AgentTypeSelector value={selectedAgent} onValueChange={setSelectedAgent} />
              <Button
                variant="outline"
                className="h-11 px-3 shrink-0"
                onClick={() => onNew(selectedAgent)}
                disabled={newDisabled}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
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

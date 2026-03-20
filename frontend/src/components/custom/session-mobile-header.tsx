import { ArrowLeft, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SESSION_STATE_DOT } from '@/lib/chat-utils';
import type { AgentSessionState } from '@agemon/shared';

export function SessionMobileHeader({
  sessionLabel,
  sessionState,
  sessionRunning,
  actionLoading,
  onBack,
  onStop,
}: {
  sessionLabel: string;
  sessionState: AgentSessionState;
  sessionRunning: boolean;
  actionLoading: boolean;
  onBack: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0 sticky top-0 z-50">
      <Button size="icon" variant="ghost" aria-label="Back to sessions" onClick={onBack} className="min-h-[44px] min-w-[44px]">
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${SESSION_STATE_DOT[sessionState]} shrink-0`} />
      <span className="text-sm font-medium flex-1 truncate">{sessionLabel}</span>
      {sessionRunning && (
        <Button
          size="sm"
          variant="outline"
          aria-label="Stop session"
          onClick={onStop}
          disabled={actionLoading}
          className="gap-1.5"
        >
          <Square className="h-3.5 w-3.5 fill-current" style={{ color: 'var(--stop-color)' }} />
          Stop
        </Button>
      )}
    </div>
  );
}

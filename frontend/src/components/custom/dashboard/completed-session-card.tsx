import { useRef, useState } from 'react';
import type { AgentSession } from '@agemon/shared';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { formatRelativeTime, formatMs } from '@/lib/time-utils';

interface CompletedSessionCardProps {
  session: AgentSession;
  taskName: string;
  onNavigate: () => void;
  onDismiss: () => void;
}

const DISMISS_THRESHOLD = 100; // px to swipe before dismissing

export function CompletedSessionCard({ session, taskName, onNavigate, onDismiss }: CompletedSessionCardProps) {
  const isDone = session.state === 'stopped';
  const ranMs = session.ended_at
    ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()
    : 0;
  const totalTokens = session.usage
    ? (session.usage.inputTokens + session.usage.outputTokens).toLocaleString()
    : null;

  // Swipe state
  const [offsetX, setOffsetX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const lockedAxisRef = useRef<'x' | 'y' | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    lockedAxisRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    // Lock to axis after 10px movement
    if (lockedAxisRef.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      lockedAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }

    if (lockedAxisRef.current === 'x') {
      // Only allow left swipe (negative dx)
      setOffsetX(Math.min(0, dx));
    }
  };

  const handleTouchEnd = () => {
    if (offsetX < -DISMISS_THRESHOLD) {
      setDismissing(true);
      // Animate out then dismiss
      setTimeout(onDismiss, 200);
    } else {
      setOffsetX(0);
    }
    startXRef.current = null;
    startYRef.current = null;
    lockedAxisRef.current = null;
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Dismiss background revealed on swipe */}
      <div className="absolute inset-0 bg-destructive/20 flex items-center justify-end pr-4">
        <span className="text-xs text-destructive font-medium">Dismiss</span>
      </div>

      {/* Card content */}
      <div
        className={`relative rounded-lg bg-card opacity-70 p-3 cursor-pointer transition-transform ${dismissing ? 'translate-x-[-100%] opacity-0 transition-all duration-200' : ''}`}
        style={!dismissing ? { transform: `translateX(${offsetX}px)` } : undefined}
        role="button"
        tabIndex={0}
        onClick={onNavigate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate(); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Top row: task name + status badge + dismiss button (desktop) */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="font-medium text-sm truncate">{taskName}</span>
          <div className="flex items-center gap-2 shrink-0">
            {isDone ? (
              <Badge variant="outline" className="text-xs border-success/30 bg-success/10 text-success">
                ✓ Done
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs border-destructive/30 bg-destructive/10 text-destructive">
                ✗ Crashed
              </Badge>
            )}
            {/* Desktop dismiss button */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="hidden sm:flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Second row: finished X ago · ran Y */}
        <p className="text-xs text-muted-foreground mb-1">
          Finished {session.ended_at ? formatRelativeTime(session.ended_at) : '—'} · Ran {formatMs(ranMs)}
        </p>

        {/* Third row: token count + cost */}
        {session.usage && (
          <p className="text-xs text-muted-foreground">
            {totalTokens} tokens
            {session.usage.cost != null ? ` · $${session.usage.cost.toFixed(2)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

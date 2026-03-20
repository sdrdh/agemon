interface SummaryStripProps {
  blocked: number;
  active: number;
  completed: number;
  tasks: number;
  onScrollTo?: (section: 'blocked' | 'active' | 'completed') => void;
  onNavigateToTasks?: () => void;
}

function Cell({ value, label, colorClass, onClick }: { value: number; label: string; colorClass: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center py-3 px-2 min-h-[44px] active:bg-muted/50 transition-colors"
      aria-label={`${value} ${label.toLowerCase()}`}
    >
      <span className={`text-2xl font-bold leading-none ${colorClass}`}>{value}</span>
      <span className="text-[11px] text-muted-foreground mt-1">{label}</span>
    </button>
  );
}

export function SummaryStrip({ blocked, active, completed, tasks, onScrollTo, onNavigateToTasks }: SummaryStripProps) {
  return (
    <div className="bg-muted/30 border-b grid grid-cols-4">
      <Cell value={blocked} label="Blocked" colorClass="text-warning" onClick={() => onScrollTo?.('blocked')} />
      <Cell value={active} label="Active" colorClass="text-success" onClick={() => onScrollTo?.('active')} />
      <Cell value={completed} label="Completed" colorClass="text-muted-foreground" onClick={() => onScrollTo?.('completed')} />
      <Cell value={tasks} label="Tasks" colorClass="text-foreground" onClick={onNavigateToTasks} />
    </div>
  );
}

interface SummaryStripProps {
  blocked: number;
  active: number;
  completed: number;
  tasks: number;
}

export function SummaryStrip({ blocked, active, completed, tasks }: SummaryStripProps) {
  return (
    <div className="bg-muted/30 border-b grid grid-cols-4">
      <div
        className="flex flex-col items-center justify-center py-3 px-2"
        aria-label={`${blocked} blocked`}
      >
        <span className="text-2xl font-bold text-warning leading-none">{blocked}</span>
        <span className="text-[11px] text-muted-foreground mt-1">Blocked</span>
      </div>
      <div
        className="flex flex-col items-center justify-center py-3 px-2"
        aria-label={`${active} active`}
      >
        <span className="text-2xl font-bold text-success leading-none">{active}</span>
        <span className="text-[11px] text-muted-foreground mt-1">Active</span>
      </div>
      <div
        className="flex flex-col items-center justify-center py-3 px-2"
        aria-label={`${completed} completed`}
      >
        <span className="text-2xl font-bold text-muted-foreground leading-none">{completed}</span>
        <span className="text-[11px] text-muted-foreground mt-1">Completed</span>
      </div>
      <div
        className="flex flex-col items-center justify-center py-3 px-2"
        aria-label={`${tasks} tasks`}
      >
        <span className="text-2xl font-bold text-foreground leading-none">{tasks}</span>
        <span className="text-[11px] text-muted-foreground mt-1">Tasks</span>
      </div>
    </div>
  );
}

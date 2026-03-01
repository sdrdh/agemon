export default function IndexPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Agemon</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        Mobile-first AI agent orchestration. Queue tasks, monitor thought streams, approve diffs — all from your phone.
      </p>
      <div className="text-sm text-muted-foreground border border-border rounded-lg px-4 py-2">
        Kanban board coming soon
      </div>
    </div>
  );
}

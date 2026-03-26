import { useState, useEffect } from 'react';
import { BookOpen, FileText, Loader2, ArrowLeft, Brain } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MemoryFile {
  taskId: string;
  type: 'memory' | 'summary';
  subpath: string;
}

interface TaskGroup {
  taskId: string;
  files: MemoryFile[];
}

function shortId(taskId: string): string {
  return taskId.slice(0, 8);
}

// ─── File View ───────────────────────────────────────────────────────────────

function FileViewSkeleton() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="h-5 w-48 rounded bg-muted" />
      <div className="space-y-2 mt-4">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
        <div className="h-3 w-4/6 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-3/6 rounded bg-muted" />
      </div>
    </div>
  );
}

function FileView({ taskId, type, onBack }: { taskId: string; type: string; onBack: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/extensions/memory-cms/memory/${taskId}/${type}`, { credentials: 'include', signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error('Not found'); return res.text(); })
      .then(setContent)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [taskId, type]);

  const isMemory = type === 'memory';

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {isMemory
            ? <BookOpen className="h-4 w-4 text-primary shrink-0" />
            : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <span className="font-medium text-sm capitalize">{type}</span>
          <span className="text-muted-foreground text-xs font-mono">· {shortId(taskId)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && <FileViewSkeleton />}
        {error && (
          <div className="p-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          </div>
        )}
        {!loading && !error && (
          <div className="p-4 prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Memory Page ─────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="p-4 space-y-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-lg border overflow-hidden animate-pulse">
          <div className="px-3 py-2 bg-muted/50">
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
          <div className="px-3 py-2.5">
            <div className="h-4 w-20 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Brain className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium mb-1">No memory files yet</p>
      <p className="text-xs text-muted-foreground max-w-xs">
        Memory files appear here as agents work on tasks.
        Claude stores context in <span className="font-mono">memory/MEMORY.md</span> inside each task directory.
      </p>
    </div>
  );
}

export default function MemoryPage() {
  const [tasks, setTasks] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ taskId: string; type: string } | null>(null);

  useEffect(() => {
    fetch('/api/extensions/memory-cms/files', { credentials: 'include' })
      .then(res => res.json())
      .then((data: MemoryFile[]) => {
        const map = new Map<string, MemoryFile[]>();
        for (const f of data) {
          if (!map.has(f.taskId)) map.set(f.taskId, []);
          map.get(f.taskId)!.push(f);
        }
        setTasks(Array.from(map.entries()).map(([taskId, files]) => ({ taskId, files })));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (selected) {
    return <FileView taskId={selected.taskId} type={selected.type} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">Memory</h1>
        {!loading && tasks.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {loading && <ListSkeleton />}
      {!loading && tasks.length === 0 && <EmptyState />}

      {!loading && tasks.length > 0 && (
        <div className="p-4 space-y-2">
          {tasks.map(({ taskId, files }) => (
            <div key={taskId} className="rounded-lg border bg-card overflow-hidden">
              {/* Task ID header */}
              <div className="px-3 py-2 bg-muted/30 border-b flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">{shortId(taskId)}</span>
                <span className="text-xs text-muted-foreground/50 font-mono truncate">{taskId.slice(8)}</span>
              </div>

              {/* File entries */}
              {files.map(f => {
                const isMemory = f.type === 'memory';
                return (
                  <button
                    key={f.type}
                    onClick={() => setSelected({ taskId, type: f.type })}
                    className="w-full flex items-center gap-3 px-3 py-3 text-sm hover:bg-muted/50 transition-colors text-left group"
                  >
                    <span className={`flex items-center justify-center h-7 w-7 rounded-md shrink-0 ${
                      isMemory ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {isMemory
                        ? <BookOpen className="h-3.5 w-3.5" />
                        : <FileText className="h-3.5 w-3.5" />
                      }
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium capitalize">{f.type}</span>
                      <p className="text-xs text-muted-foreground font-mono truncate">{f.subpath}</p>
                    </div>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground rotate-180 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

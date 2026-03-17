import { useState, useEffect } from 'react';
import { FileText, BookOpen, Loader2, ChevronRight } from 'lucide-react';
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

function FileView({ taskId, type, onBack }: { taskId: string; type: string; onBack: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/memory/${taskId}/${type}`, { credentials: 'include' })
      .then(res => { if (!res.ok) throw new Error('Not found'); return res.text(); })
      .then(setContent)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId, type]);

  return (
    <div className="p-4">
      <button onClick={onBack} className="text-sm text-muted-foreground mb-4 flex items-center gap-1 hover:text-foreground">
        ← Back
      </button>
      <div className="flex items-center gap-2 mb-3">
        {type === 'memory' ? <BookOpen className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        <span className="font-medium capitalize">{type}</span>
        <span className="text-muted-foreground text-sm">• {taskId}</span>
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>}
      {error && <div className="text-destructive text-sm">{error}</div>}
      {!loading && !error && (
        <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 max-w-none text-sm">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      )}
    </div>
  );
}

export default function MemoryPage() {
  const [tasks, setTasks] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ taskId: string; type: string } | null>(null);

  useEffect(() => {
    fetch('/api/plugins/memory-cms/files', { credentials: 'include' })
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
    <div className="p-4">
      <h1 className="text-base font-semibold mb-4">Memory</h1>
      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>}
      {!loading && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No memory files found.</p>
      )}
      <div className="space-y-2">
        {tasks.map(({ taskId, files }) => (
          <div key={taskId} className="rounded-lg border bg-card">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b font-mono">{taskId}</div>
            {files.map(f => {
              const Icon = f.type === 'memory' ? BookOpen : FileText;
              return (
                <button
                  key={f.type}
                  onClick={() => setSelected({ taskId, type: f.type })}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="capitalize">{f.type}</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

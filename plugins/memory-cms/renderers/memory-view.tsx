import { useState, useEffect } from 'react';
import { FileText, BookOpen, Loader2 } from 'lucide-react';

export const renderer = {
  manifest: {
    name: 'memory-view',
    messageType: 'memory-view',
    label: 'Memory View',
    description: 'Displays task memory and summary files',
  },
};

interface MessageData {
  taskId: string;
  type: 'memory' | 'summary';
  content?: string;
}

function MemoryViewer({ message }: { message: MessageData }) {
  const [loading, setLoading] = useState(!message.content);
  const [content, setContent] = useState(message.content ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (message.content) {
      setContent(message.content);
      setLoading(false);
      return;
    }

    fetch(`/api/memory/${message.taskId}/${message.type}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.text();
      })
      .then(setContent)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [message.taskId, message.type, message.content]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {message.type}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load {message.type}: {error}
      </div>
    );
  }

  const Icon = message.type === 'memory' ? BookOpen : FileText;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium capitalize">{message.type}</span>
        <span className="text-muted-foreground">• {message.taskId}</span>
      </div>
      <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded overflow-x-auto max-h-64">
        {content}
      </pre>
    </div>
  );
}

export default function MemoryViewRenderer({ message }: { message: unknown }) {
  const data = message as MessageData;
  return <MemoryViewer message={data} />;
}

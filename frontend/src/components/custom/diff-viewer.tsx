import { useEffect, useMemo, useState, useRef } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff as PierreFileDiff, Virtualizer } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface DiffViewerProps {
  sessionId: string;
  live?: boolean;
}

function useDiffData(sessionId: string, live: boolean) {
  const [rawDiff, setRawDiff] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [liveUpdating, setLiveUpdating] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!live) {
      fetchOnce();
      return;
    }

    const eventSource = new EventSource(`/api/sessions/${sessionId}/diff/stream`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('diff', (event) => {
      const data = JSON.parse(event.data);
      setRawDiff(data.raw || '');
      setLoading(false);
      setLiveUpdating(true);
    });

    eventSource.addEventListener('done', () => {
      setLiveUpdating(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', () => {
      setLiveUpdating(false);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [sessionId, live]);

  async function fetchOnce() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/diff`);
      const data = await res.json();
      setRawDiff(data.raw || '');
    } catch (err) {
      console.error('Failed to fetch diff:', err);
    } finally {
      setLoading(false);
    }
  }

  return { rawDiff, loading, liveUpdating };
}

function getFileStats(file: FileDiffMetadata) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

export function DiffViewer({ sessionId, live = true }: DiffViewerProps) {
  const { rawDiff, loading, liveUpdating } = useDiffData(sessionId, live);

  const parsedDiffs = useMemo(() => {
    if (!rawDiff) return [];
    try {
      return parsePatchFiles(rawDiff);
    } catch {
      return [];
    }
  }, [rawDiff]);

  const files = useMemo(() => {
    const allFiles: { file: FileDiffMetadata; stats: { additions: number; deletions: number } }[] = [];
    for (const patch of parsedDiffs) {
      for (const file of patch.files) {
        allFiles.push({ file, stats: getFileStats(file) });
      }
    }
    return allFiles;
  }, [parsedDiffs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
        <span className="animate-pulse">Loading changes...</span>
        {liveUpdating && <span className="text-xs">(live)</span>}
      </div>
    );
  }

  if (files.length === 0) {
    return <p className="text-muted-foreground text-sm p-3">No changes</p>;
  }

  return (
    <div className="flex flex-col h-full">
      {liveUpdating && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground border-b border-border">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Updating...
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {files.map(({ file, stats }) => (
          <FileDiffCollapsed key={file.name} file={file} stats={stats} />
        ))}
      </div>
    </div>
  );
}

function FileDiffCollapsed({ file, stats }: { file: FileDiffMetadata; stats: { additions: number; deletions: number } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-mono truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="text-emerald-500">+{stats.additions}</span>
          <span className="text-red-500">-{stats.deletions}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <Virtualizer>
            <PierreFileDiff fileDiff={file} />
          </Virtualizer>
        </div>
      )}
    </div>
  );
}

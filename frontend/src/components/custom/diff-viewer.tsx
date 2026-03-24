import { useEffect, useMemo, useState, useRef } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff as PierreFileDiff, Virtualizer } from '@pierre/diffs/react';

interface DiffViewerProps {
  sessionId: string;
  live?: boolean;
}

interface FileEntry {
  path: string;
  additions: number;
  deletions: number;
}

interface RepoGroup {
  name: string;
  files: FileEntry[];
}

function useDiffData(sessionId: string, live: boolean) {
  const [repos, setRepos] = useState<RepoGroup[]>([]);
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
      setRepos(data.repos || []);
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
      const res = await fetch(`/api/sessions/${sessionId}/diff?format=structured`);
      const data = await res.json();
      setRepos(data.repos || []);
      setRawDiff(data.raw || '');
    } catch (err) {
      console.error('Failed to fetch diff:', err);
    } finally {
      setLoading(false);
    }
  }

  return { repos, rawDiff, loading, liveUpdating };
}

export function DiffViewer({ sessionId, live = true }: DiffViewerProps) {
  const { repos, rawDiff, loading, liveUpdating } = useDiffData(sessionId, live);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const parsedDiffs = useMemo(() => {
    if (!rawDiff) return [];
    try {
      return parsePatchFiles(rawDiff);
    } catch {
      return [];
    }
  }, [rawDiff]);

  const selectedFileDiff = useMemo((): FileDiffMetadata | null => {
    if (!selectedFile || parsedDiffs.length === 0) return null;
    for (const patch of parsedDiffs) {
      for (const file of patch.files) {
        if (file.name === selectedFile) return file;
      }
    }
    return null;
  }, [selectedFile, parsedDiffs]);

  // Calculate additions/deletions from hunks
  const getFileStats = (file: FileDiffMetadata) => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of file.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    return { additions, deletions };
  };

  const fileStatsMap = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const patch of parsedDiffs) {
      for (const file of patch.files) {
        const stats = getFileStats(file);
        map.set(file.name, stats);
      }
    }
    return map;
  }, [parsedDiffs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
        <span className="animate-pulse">Loading changes...</span>
        {liveUpdating && <span className="text-xs">(live)</span>}
      </div>
    );
  }

  if (repos.length === 0 || parsedDiffs.length === 0) {
    return <p className="text-muted-foreground text-sm p-3">No changes</p>;
  }

  const activeRepo = repos.length === 1 ? repos[0] : null;

  const files = activeRepo
    ? activeRepo.files.map((f) => ({ ...f, ...(fileStatsMap.get(f.path) || { additions: 0, deletions: 0 }) }))
    : repos.flatMap((r) => r.files.map((f) => ({ ...f, ...(fileStatsMap.get(f.path) || { additions: 0, deletions: 0 }) })));

  return (
    <div className="flex flex-col h-full">
      {liveUpdating && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground border-b border-border">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Updating...
        </div>
      )}

      {repos.length > 1 && (
        <div className="flex border-b border-border overflow-x-auto">
          {repos.map(({ name }) => (
            <button
              key={name}
              onClick={() => setSelectedFile(null)}
              className="px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 border-transparent hover:border-border"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {!selectedFile && (
        <div className="flex-1 overflow-auto divide-y divide-border">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => setSelectedFile(file.path)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
            >
              <span className="text-sm font-mono truncate">{file.path}</span>
              <div className="flex items-center gap-2 text-xs shrink-0">
                <span className="text-emerald-500">+{file.additions}</span>
                <span className="text-red-500">-{file.deletions}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedFile && selectedFileDiff && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b border-border"
          >
            ← Back to file list
          </button>
          <div className="flex-1 overflow-auto">
            <Virtualizer>
              <PierreFileDiff fileDiff={selectedFileDiff} />
            </Virtualizer>
          </div>
        </div>
      )}

      {selectedFile && !selectedFileDiff && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b border-border"
          >
            ← Back to file list
          </button>
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
              Failed to render diff for {selectedFile}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

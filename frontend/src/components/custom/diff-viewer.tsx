import { Component, useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff as PierreFileDiff, Virtualizer } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface DiffViewerProps {
  sessionId: string;
  live?: boolean;
}

// ─── Data fetching ────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function getFileStats(file: FileDiffMetadata) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

/** Extract raw unified diff text for a single file from the full diff string. */
function extractRawFileSection(rawDiff: string, fileName: string): string {
  const lines = rawDiff.split('\n');
  const sections: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (capturing) break;
      // Match "diff --git a/path b/path" — check if the b/ side matches
      if (line.includes(` b/${fileName}`)) capturing = true;
    }
    if (capturing) sections.push(line);
  }
  return sections.join('\n');
}

// ─── Error boundary ───────────────────────────────────────────────────────────────

interface DiffErrorBoundaryProps {
  fallback: string;
  children: ReactNode;
}

interface DiffErrorBoundaryState {
  hasError: boolean;
}

class DiffErrorBoundary extends Component<DiffErrorBoundaryProps, DiffErrorBoundaryState> {
  constructor(props: DiffErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): DiffErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <pre className="text-xs text-muted-foreground p-3 overflow-auto whitespace-pre-wrap">
          {this.props.fallback || 'Failed to render diff'}
        </pre>
      );
    }
    return this.props.children;
  }
}

// ─── Summary bar ─────────────────────────────────────────────────────────────────

function DiffSummaryBar({ files, liveUpdating }: {
  files: { stats: { additions: number; deletions: number } }[];
  liveUpdating: boolean;
}) {
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const { stats } of files) {
      additions += stats.additions;
      deletions += stats.deletions;
    }
    return { additions, deletions };
  }, [files]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border text-xs text-muted-foreground shrink-0">
      {liveUpdating && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      )}
      <span className="font-medium text-foreground">
        {files.length} {files.length === 1 ? 'file' : 'files'} changed
      </span>
      <span className="text-emerald-500 font-mono">+{totals.additions}</span>
      <span className="text-red-500 font-mono">−{totals.deletions}</span>
    </div>
  );
}

// ─── Per-file collapsed diff ─────────────────────────────────────────────────────

/**
 * Fetch full file contents (old from HEAD, new from working tree) and rebuild
 * the FileDiffMetadata with isPartial=false so hunk expansion works.
 */
function useFullFileDiff(
  sessionId: string,
  partialFile: FileDiffMetadata,
  shouldFetch: boolean,
): { fileDiff: FileDiffMetadata; loading: boolean } {
  const [fullDiff, setFullDiff] = useState<FileDiffMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shouldFetch || fullDiff) return;
    setLoading(true);

    fetch(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(partialFile.name)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ oldContent, newContent }: { oldContent: string; newContent: string }) => {
        // Rebuild with full file lines so the library can expand between hunks
        const rebuilt: FileDiffMetadata = {
          ...partialFile,
          isPartial: false,
          deletionLines: (oldContent || '').split('\n'),
          additionLines: (newContent || '').split('\n'),
        };
        setFullDiff(rebuilt);
      })
      .catch(() => {
        // Fall back to partial diff if fetch fails
        setFullDiff(null);
      })
      .finally(() => setLoading(false));
  }, [sessionId, partialFile.name, shouldFetch, fullDiff]);

  return { fileDiff: fullDiff ?? partialFile, loading };
}

function FileDiffCollapsed({ file, stats, rawDiff, sessionId }: {
  file: FileDiffMetadata;
  stats: { additions: number; deletions: number };
  rawDiff: string;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { fileDiff, loading: fileLoading } = useFullFileDiff(sessionId, file, expanded);

  // Lazy-extract the raw section only when needed for fallback
  const rawSection = useMemo(
    () => expanded ? extractRawFileSection(rawDiff, file.name) : '',
    [expanded, rawDiff, file.name],
  );

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 shrink-0" />
            : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="text-sm font-mono truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0 ml-2">
          <span className="text-emerald-500">+{stats.additions}</span>
          <span className="text-red-500">−{stats.deletions}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border">
          {fileLoading ? (
            <div className="p-3 text-xs text-muted-foreground animate-pulse">Loading file...</div>
          ) : (
            <DiffErrorBoundary fallback={rawSection}>
              <Virtualizer>
                <PierreFileDiff
                  fileDiff={fileDiff}
                  options={{
                    expandUnchanged: true,
                    hunkSeparators: 'line-info',
                    expansionLineCount: 20,
                  }}
                />
              </Virtualizer>
            </DiffErrorBoundary>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────

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
      </div>
    );
  }

  if (files.length === 0) {
    return <p className="text-muted-foreground text-sm p-3">No changes</p>;
  }

  return (
    <div className="flex flex-col h-full">
      <DiffSummaryBar files={files} liveUpdating={liveUpdating} />
      <div className="flex-1 overflow-auto">
        {files.map(({ file, stats }) => (
          <FileDiffCollapsed key={file.name} file={file} stats={stats} rawDiff={rawDiff} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, ArrowLeft, Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/api';
import type { RepoDiff } from '@/components/custom/diff-viewer';

export type FsEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;
  size?: number;
  children?: FsEntry[];
};

type DiffLine = { line: string; kind: 'added' | 'removed' | 'unchanged' };

type FileTreeViewerProps =
  | { mode: 'session'; sessionId: string; diffRepos?: RepoDiff[] }
  | { mode: 'fs' };

type FileView = { path: string; content: string; oldContent?: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiFetch(url: string) {
  return fetch(url, { headers: authHeaders(), credentials: 'include' });
}

function buildChangedSets(diffRepos: RepoDiff[]): { changedPaths: Set<string>; ancestorPaths: Set<string> } {
  const changedPaths = new Set<string>();
  for (const repo of diffRepos) {
    const matches = repo.diff.matchAll(/^diff --git a\/(.+?) b\//gm);
    for (const m of matches) {
      changedPaths.add(m[1]);
      changedPaths.add(`${repo.repoName}/${m[1]}`);
    }
  }
  const ancestorPaths = new Set<string>();
  for (const p of changedPaths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      ancestorPaths.add(parts.slice(0, i).join('/'));
    }
  }
  return { changedPaths, ancestorPaths };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Produces a simple line-level diff between old and new content.
 * Uses a greedy LCS approach suitable for small-to-medium files.
 */
function computeLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');
  const m = oldLines.length;
  const n = newLines.length;
  if (m * n > 200_000) {
    return [
      ...oldLines.map(line => ({ line, kind: 'removed' as const })),
      ...newLines.map(line => ({ line, kind: 'added' as const })),
    ];
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ line: oldLines[i], kind: 'unchanged' }); i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] <= dp[i][j + 1])) {
      result.push({ line: newLines[j], kind: 'added' }); j++;
    } else {
      result.push({ line: oldLines[i], kind: 'removed' }); i++;
    }
  }
  return result;
}

// ─── Tree Node ────────────────────────────────────────────────────────────────

const TreeNode = memo(function TreeNode({
  entry,
  treeMap,
  onExpand,
  fetching,
  changedPaths,
  ancestorPaths,
  filterChanged,
  onFileClick,
}: {
  entry: FsEntry;
  treeMap: Map<string, FsEntry[]>;
  onExpand: (entry: FsEntry) => void;
  fetching: Set<string>;
  changedPaths: Set<string>;
  ancestorPaths: Set<string>;
  filterChanged: boolean;
  onFileClick: (entry: FsEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  const isChanged = changedPaths.has(entry.path);
  const hasChangedDescendants = entry.type === 'dir' && ancestorPaths.has(entry.path);

  if (filterChanged && entry.type === 'file' && !isChanged) return null;
  if (filterChanged && entry.type === 'dir' && !hasChangedDescendants) return null;

  const children = treeMap.get(entry.path);
  const isFetching = fetching.has(entry.path);

  const handleDirClick = () => {
    if (!open && !children) onExpand(entry);
    setOpen(o => !o);
  };

  const dot = isChanged ? <span className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0" /> : null;

  if (entry.type === 'file') {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-0.5 text-sm cursor-pointer hover:bg-muted/50 min-h-[32px]"
        onClick={() => onFileClick(entry)}
      >
        <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate flex-1">{entry.name}</span>
        {entry.size !== undefined && (
          <span className="text-xs text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
        )}
        {dot}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-3 py-0.5 text-sm cursor-pointer hover:bg-muted/50 min-h-[32px]"
        onClick={handleDirClick}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        {open ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="truncate flex-1">{entry.name}</span>
        {isFetching && <Loader2 className="h-3 w-3 text-muted-foreground animate-spin shrink-0" />}
        {dot}
      </div>
      {open && (
        <div className="pl-4">
          {children
            ? children.map(child => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  treeMap={treeMap}
                  onExpand={onExpand}
                  fetching={fetching}
                  changedPaths={changedPaths}
                  ancestorPaths={ancestorPaths}
                  filterChanged={filterChanged}
                  onFileClick={onFileClick}
                />
              ))
            : !isFetching && <div className="px-3 py-1 text-xs text-muted-foreground">Loading...</div>
          }
        </div>
      )}
    </div>
  );
});

// ─── File Content View ────────────────────────────────────────────────────────

function FileContentView({ fileView, onBack }: { fileView: FileView; onBack: () => void }) {
  const pathParts = fileView.path.split('/');
  const diffLines = useMemo<DiffLine[] | null>(() =>
    fileView.oldContent !== undefined && fileView.oldContent !== ''
      ? computeLineDiff(fileView.oldContent, fileView.content)
      : null,
    [fileView.oldContent, fileView.content]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Files
        </button>
        <span className="text-muted-foreground">/</span>
        <div className="flex items-center gap-1 text-xs font-mono overflow-hidden">
          {pathParts.map((part, i) => (
            <span key={i} className={i === pathParts.length - 1 ? 'text-foreground' : 'text-muted-foreground'}>
              {i > 0 && <span className="mr-1">/</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {diffLines ? (
          <pre className="text-xs font-mono p-3 whitespace-pre-wrap leading-relaxed">
            {diffLines.map((dl, i) => (
              <div
                key={i}
                className={dl.kind === 'added' ? 'bg-emerald-950/40 text-emerald-400' : dl.kind === 'removed' ? 'bg-red-950/40 text-red-400' : ''}
              >
                {dl.kind === 'added' ? '+' : dl.kind === 'removed' ? '-' : ' '} {dl.line}
              </div>
            ))}
          </pre>
        ) : (
          <pre className="text-xs font-mono p-3 whitespace-pre-wrap leading-relaxed text-foreground">
            {fileView.content}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FileTreeViewer(props: FileTreeViewerProps) {
  const [treeMap, setTreeMap] = useState<Map<string, FsEntry[]>>(new Map());
  const [fetching, setFetching] = useState<Set<string>>(new Set());
  const [filterChanged, setFilterChanged] = useState(false);
  const [fileView, setFileView] = useState<FileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Refs to read latest state without adding to useCallback deps
  const treeMapRef = useRef(treeMap);
  treeMapRef.current = treeMap;
  const fetchingRef = useRef(fetching);
  fetchingRef.current = fetching;

  const sessionId = props.mode === 'session' ? props.sessionId : null;
  const diffRepos = props.mode === 'session' ? (props.diffRepos ?? []) : [];

  const { changedPaths, ancestorPaths } = useMemo(() => buildChangedSets(diffRepos), [diffRepos]);

  const fsUrl = useCallback((relPath: string, depth = 2) =>
    sessionId
      ? `/api/sessions/${sessionId}/fs?path=${encodeURIComponent(relPath)}&depth=${depth}`
      : `/api/fs?path=${encodeURIComponent(relPath)}&depth=${depth}`,
    [sessionId]
  );

  const fetchEntries = useCallback(async (relPath: string, depth = 2) => {
    const data = await apiFetch(fsUrl(relPath, depth)).then(r => r.json()) as { entries: FsEntry[] };
    return data.entries ?? [];
  }, [fsUrl]);

  const populateMap = useCallback((entries: FsEntry[], map: Map<string, FsEntry[]>, parentPath: string) => {
    map.set(parentPath, entries);
    for (const entry of entries) {
      if (entry.type === 'dir' && entry.children) populateMap(entry.children, map, entry.path);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    fetchEntries('', 2).then(entries => {
      const map = new Map<string, FsEntry[]>();
      populateMap(entries, map, '');
      setTreeMap(map);
      setLoading(false);
    }).catch(() => { setLoading(false); setLoadError(true); });
  }, [sessionId]);

  const handleExpand = useCallback((entry: FsEntry) => {
    // Guard using refs to avoid stale closures without adding state to deps
    if (treeMapRef.current.has(entry.path) || fetchingRef.current.has(entry.path)) return;
    setFetching(prev => new Set(prev).add(entry.path));
    fetchEntries(entry.path, 2).then(entries => {
      setTreeMap(cur => {
        const next = new Map(cur);
        populateMap(entries, next, entry.path);
        return next;
      });
      setFetching(cur => { const s = new Set(cur); s.delete(entry.path); return s; });
    }).catch(() => {
      setFetching(cur => { const s = new Set(cur); s.delete(entry.path); return s; });
    });
  }, [fetchEntries, populateMap]);

  const handleFileClick = useCallback(async (entry: FsEntry) => {
    if (sessionId) {
      const data = await apiFetch(
        `/api/sessions/${sessionId}/file?path=${encodeURIComponent(entry.path)}`
      ).then(r => r.json()) as { oldContent: string; newContent: string };
      setFileView({ path: entry.path, content: data.newContent, oldContent: data.oldContent });
    } else {
      const data = await apiFetch(
        `/api/fs/file?path=${encodeURIComponent(entry.path)}`
      ).then(r => r.json()) as { content: string };
      setFileView({ path: entry.path, content: data.content });
    }
  }, [sessionId]);

  if (fileView) {
    return <FileContentView fileView={fileView} onBack={() => setFileView(null)} />;
  }

  const rootEntries = treeMap.get('') ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs text-muted-foreground font-mono">
          {sessionId ? 'session root' : '~'}
        </span>
        {props.mode === 'session' && diffRepos.length > 0 && (
          <button
            onClick={() => setFilterChanged(f => !f)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              filterChanged
                ? 'bg-primary/10 border-primary/50 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {filterChanged ? '● Changed only' : 'Changed only'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : loadError ? (
          <p className="p-3 text-sm text-muted-foreground">Failed to load directory.</p>
        ) : rootEntries.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Empty directory</p>
        ) : (
          rootEntries.map(entry => (
            <TreeNode
              key={entry.path}
              entry={entry}
              treeMap={treeMap}
              onExpand={handleExpand}
              fetching={fetching}
              changedPaths={changedPaths}
              ancestorPaths={ancestorPaths}
              filterChanged={filterChanged}
              onFileClick={handleFileClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

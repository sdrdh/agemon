import { Component, useEffect, useMemo, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import { parsePatchFiles, parseDiffFromFile, type FileDiffMetadata, type FileContents, type ThemeTypes, type ThemesType } from '@pierre/diffs';
import { FileDiff as PierreFileDiff, Virtualizer } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight, GitCommit, ArrowLeft } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import type { ThemeId } from '@/lib/theme';

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

// ─── Commit data fetching ─────────────────────────────────────────────────────────

interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
  filesChanged: number;
}

function useCommitList(sessionId: string, enabled: boolean) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [baseSha, setBaseSha] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    fetch(`/api/sessions/${sessionId}/commits`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setCommits(data.commits || []);
          setBaseSha(data.baseSha || '');
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId, enabled]);

  return { commits, baseSha, loading, error };
}

function useCommitDiff(sessionId: string, sha: string | null) {
  const [rawDiff, setRawDiff] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sha) { setRawDiff(''); return; }
    setLoading(true);
    fetch(`/api/sessions/${sessionId}/commits/${sha}/diff`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setRawDiff(data.raw || ''))
      .catch(() => setRawDiff(''))
      .finally(() => setLoading(false));
  }, [sessionId, sha]);

  return { rawDiff, loading };
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

// ─── Theme integration ───────────────────────────────────────────────────────────

/** Map agemon theme → Shiki syntax highlighting theme pair */
function getDiffsTheme(themeId: ThemeId): ThemesType {
  switch (themeId) {
    case 'dracula':
      return { dark: 'dracula', light: 'dracula' };
    case 'one-dark-pro':
      return { dark: 'one-dark-pro', light: 'one-dark-pro' };
    case 'terminal-green':
      return { dark: 'github-dark', light: 'github-dark' };
    case 'cyber-indigo':
    case 'graphite-line-indigo':
      return { dark: 'github-dark', light: 'github-light' };
    case 'monochrome-stealth':
    default:
      return { dark: 'github-dark', light: 'github-light' };
  }
}

/** Resolve effective dark/light from agemon's color mode */
function useEffectiveThemeType(): ThemeTypes {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark ? 'dark' : 'light';
}

/**
 * Build CSS variable overrides so the diff viewer's backgrounds, borders,
 * and text colours match the active agemon theme.  We read from the app's
 * HSL CSS custom properties at render time via getComputedStyle.
 */
function useDiffStyleOverrides(): CSSProperties {
  const themeType = useEffectiveThemeType();

  // Re-resolve whenever the theme flips
  return useMemo(() => {
    return {
      // Font — use the same monospace font the app already uses
      '--diffs-font-family': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      '--diffs-font-size': '13px',
      '--diffs-line-height': '20px',
      '--diffs-header-font-family': 'inherit',
      // Narrow gap for compact look
      '--diffs-gap-inline': '6px',
      '--diffs-gap-block': '4px',
    } as CSSProperties;
  }, [themeType]);
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

  componentDidUpdate(prevProps: DiffErrorBoundaryProps) {
    if (this.state.hasError && prevProps.fallback !== this.props.fallback) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error) {
    console.warn('DiffErrorBoundary caught:', error.message);
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
 * Fetch full file contents (old from HEAD, new from working tree) and use
 * parseDiffFromFile to produce a FileDiffMetadata with isPartial=false and
 * correct hunk indexes aligned to the full line arrays.
 */
function useFullFileDiff(
  sessionId: string,
  partialFile: FileDiffMetadata,
  shouldFetch: boolean,
): { fileDiff: FileDiffMetadata; loading: boolean; hasFullFile: boolean } {
  const [fullDiff, setFullDiff] = useState<FileDiffMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shouldFetch || fullDiff) return;
    setLoading(true);

    fetch(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(partialFile.name)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ oldContent, newContent }: { oldContent: string; newContent: string }) => {
        try {
          const oldFile: FileContents = { name: partialFile.name, contents: oldContent || '' };
          const newFile: FileContents = { name: partialFile.name, contents: newContent || '' };
          const rebuilt = parseDiffFromFile(oldFile, newFile);
          setFullDiff(rebuilt);
        } catch (e) {
          console.warn('parseDiffFromFile failed, falling back to partial:', e);
          setFullDiff(null);
        }
      })
      .catch(() => {
        // Fall back to partial diff if fetch fails
        setFullDiff(null);
      })
      .finally(() => setLoading(false));
  }, [sessionId, partialFile.name, shouldFetch, fullDiff]);

  return { fileDiff: fullDiff ?? partialFile, loading, hasFullFile: fullDiff !== null };
}

function FileDiffCollapsed({ file, stats, rawDiff, sessionId, diffTheme, themeType, styleOverrides, diffStyle }: {
  file: FileDiffMetadata;
  stats: { additions: number; deletions: number };
  rawDiff: string;
  sessionId: string;
  diffTheme: ThemesType;
  themeType: ThemeTypes;
  styleOverrides: CSSProperties;
  diffStyle: 'unified' | 'split';
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
                  style={styleOverrides}
                  options={{
                    expandUnchanged: false,
                    hunkSeparators: 'line-info',
                    expansionLineCount: 20,
                    theme: diffTheme,
                    themeType,
                    diffStyle,
                    overflow: 'wrap',
                    disableFileHeader: true,
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

// ─── Commit list ────────────────────────────────────────────────────────────────

function formatCommitDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function CommitListItem({ commit, onClick }: { commit: CommitInfo; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border transition-colors"
    >
      <GitCommit className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{commit.message}</p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{commit.shortSha}</span>
          <span>·</span>
          <span>{commit.author}</span>
          <span>·</span>
          <span>{formatCommitDate(commit.date)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs shrink-0 mt-0.5">
        <span className="text-muted-foreground">{commit.filesChanged}f</span>
        <span className="text-emerald-500">+{commit.additions}</span>
        <span className="text-red-500">−{commit.deletions}</span>
      </div>
    </button>
  );
}

/** Full commit diff view: back button + file list for a single commit */
function CommitDiffView({ sessionId, commit, onBack, diffTheme, themeType, styleOverrides, diffStyle }: {
  sessionId: string;
  commit: CommitInfo;
  onBack: () => void;
  diffTheme: ThemesType;
  themeType: ThemeTypes;
  styleOverrides: CSSProperties;
  diffStyle: 'unified' | 'split';
}) {
  const { rawDiff, loading } = useCommitDiff(sessionId, commit.sha);

  const files = useMemo(() => {
    if (!rawDiff) return [];
    try {
      const patches = parsePatchFiles(rawDiff);
      const allFiles: { file: FileDiffMetadata; stats: { additions: number; deletions: number } }[] = [];
      for (const patch of patches) {
        for (const file of patch.files) {
          allFiles.push({ file, stats: getFileStats(file) });
        }
      }
      return allFiles;
    } catch {
      return [];
    }
  }, [rawDiff]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button onClick={onBack} className="p-1 rounded-md hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{commit.message}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{commit.shortSha}</span>
            {' · '}{commit.author}
            {' · '}{formatCommitDate(commit.date)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="text-emerald-500">+{commit.additions}</span>
          <span className="text-red-500">−{commit.deletions}</span>
        </div>
      </div>
      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading commit diff...</div>
        ) : files.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No file changes in this commit</p>
        ) : (
          files.map(({ file, stats }) => (
            <CommitFileDiffCollapsed
              key={file.name}
              file={file}
              stats={stats}
              rawDiff={rawDiff}
              diffTheme={diffTheme}
              themeType={themeType}
              styleOverrides={styleOverrides}
              diffStyle={diffStyle}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** File diff within a commit — no full-file expansion needed, diff is self-contained */
function CommitFileDiffCollapsed({ file, stats, rawDiff, diffTheme, themeType, styleOverrides, diffStyle }: {
  file: FileDiffMetadata;
  stats: { additions: number; deletions: number };
  rawDiff: string;
  diffTheme: ThemesType;
  themeType: ThemeTypes;
  styleOverrides: CSSProperties;
  diffStyle: 'unified' | 'split';
}) {
  const [expanded, setExpanded] = useState(false);

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
          <DiffErrorBoundary fallback={rawSection}>
            <Virtualizer>
              <PierreFileDiff
                fileDiff={file}
                style={styleOverrides}
                options={{
                  expandUnchanged: false,
                  hunkSeparators: 'line-info',
                  expansionLineCount: 20,
                  theme: diffTheme,
                  themeType,
                  diffStyle,
                  overflow: 'wrap',
                  disableFileHeader: true,
                }}
              />
            </Virtualizer>
          </DiffErrorBoundary>
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────

type DiffTab = 'changes' | 'commits';

export function DiffViewer({ sessionId, live = true }: DiffViewerProps) {
  const { rawDiff, loading, liveUpdating } = useDiffData(sessionId, live);
  const { themeId } = useTheme();
  const isDesktop = useIsDesktop();
  const themeType = useEffectiveThemeType();
  const diffTheme = useMemo(() => getDiffsTheme(themeId), [themeId]);
  const styleOverrides = useDiffStyleOverrides();
  const diffStyle = isDesktop ? 'split' as const : 'unified' as const;

  const [tab, setTab] = useState<DiffTab>('changes');
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const { commits, loading: commitsLoading, error: commitsError } = useCommitList(sessionId, tab === 'commits');

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

  // If viewing a commit diff, show that instead of the tab layout
  if (selectedCommit) {
    return (
      <CommitDiffView
        sessionId={sessionId}
        commit={selectedCommit}
        onBack={() => setSelectedCommit(null)}
        diffTheme={diffTheme}
        themeType={themeType}
        styleOverrides={styleOverrides}
        diffStyle={diffStyle}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
        <span className="animate-pulse">Loading changes...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0">
        <button
          onClick={() => setTab('changes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'changes'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Changes
          {files.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">{files.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('commits')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'commits'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Commits
          {commits.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">{commits.length}</span>
          )}
        </button>
        {liveUpdating && tab === 'changes' && (
          <span className="flex items-center gap-1.5 ml-auto mr-3 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Tab content */}
      {tab === 'changes' ? (
        files.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No uncommitted changes</p>
        ) : (
          <>
            <DiffSummaryBar files={files} liveUpdating={false} />
            <div className="flex-1 overflow-auto">
              {files.map(({ file, stats }) => (
                <FileDiffCollapsed
                  key={file.name}
                  file={file}
                  stats={stats}
                  rawDiff={rawDiff}
                  sessionId={sessionId}
                  diffTheme={diffTheme}
                  themeType={themeType}
                  styleOverrides={styleOverrides}
                  diffStyle={diffStyle}
                />
              ))}
            </div>
          </>
        )
      ) : (
        <div className="flex-1 overflow-auto">
          {commitsLoading ? (
            <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading commits...</div>
          ) : commitsError ? (
            <p className="text-muted-foreground text-sm p-3">{commitsError}</p>
          ) : commits.length === 0 ? (
            <p className="text-muted-foreground text-sm p-3">No commits found</p>
          ) : (
            commits.map(commit => (
              <CommitListItem
                key={commit.sha}
                commit={commit}
                onClick={() => setSelectedCommit(commit)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

import { Component, useEffect, useMemo, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import { parsePatchFiles, parseDiffFromFile, type FileDiffMetadata, type FileContents, type ThemeTypes, type ThemesType } from '@pierre/diffs';
import { FileDiff as PierreFileDiff, Virtualizer } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight, GitCommit, ArrowLeft } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import type { ThemeId } from '@/lib/theme';
import { formatRelativeTime } from '@/lib/time-utils';

export interface RepoDiff {
  repoName: string;
  cwd: string;
  diff: string;
}

interface DiffViewerProps {
  sessionId: string;
  live?: boolean;
  repos?: RepoDiff[];
}

interface DiffRenderProps {
  diffTheme: ThemesType;
  themeType: ThemeTypes;
  styleOverrides: CSSProperties;
  diffStyle: 'unified' | 'split';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function apiFetch(url: string): Promise<Response> {
  return fetch(url, { credentials: 'include' });
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

function parseFilesFromDiff(rawDiff: string): { file: FileDiffMetadata; stats: { additions: number; deletions: number } }[] {
  if (!rawDiff) return [];
  try {
    const patches = parsePatchFiles(rawDiff);
    return patches.flatMap(p => p.files.map(file => ({ file, stats: getFileStats(file) })));
  } catch {
    return [];
  }
}

function extractRawFileSection(rawDiff: string, fileName: string): string {
  const lines = rawDiff.split('\n');
  const sections: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (capturing) break;
      if (line.includes(` b/${fileName}`)) capturing = true;
    }
    if (capturing) sections.push(line);
  }
  return sections.join('\n');
}

// ─── Data fetching ────────────────────────────────────────────────────────────────

function useDiffData(sessionId: string, live: boolean) {
  const [repos, setRepos] = useState<RepoDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveUpdating, setLiveUpdating] = useState(false);

  useEffect(() => {
    if (!live) {
      apiFetch(`/api/sessions/${sessionId}/diff`)
        .then(r => r.json())
        .then(data => setRepos(data.repos ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }

    const eventSource = new EventSource(`/api/sessions/${sessionId}/diff/stream`);

    eventSource.addEventListener('diff', (event) => {
      const data = JSON.parse(event.data);
      setRepos(data.repos ?? []);
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

    return () => eventSource.close();
  }, [sessionId, live]);

  return { repos, loading, liveUpdating };
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

interface BaseInfo {
  sha: string;
  shortSha: string;
  ref: string;
  message: string;
}

interface RefsData {
  currentBranch: string;
  defaultBase: string;
  local: string[];
  remote: string[];
}

function useRefs(sessionId: string, repoName: string, enabled: boolean) {
  const [refs, setRefs] = useState<RefsData | null>(null);

  useEffect(() => {
    if (!enabled || !repoName) return;
    setRefs(null);
    apiFetch(`/api/sessions/${sessionId}/refs?repo=${encodeURIComponent(repoName)}`)
      .then(r => r.json())
      .then(data => { if (!data.error) setRefs(data); })
      .catch(() => {});
  }, [sessionId, repoName, enabled]);

  return refs;
}

function useCommitList(sessionId: string, repoName: string, enabled: boolean, baseRef: string) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [base, setBase] = useState<BaseInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !repoName) return;
    setCommits([]);
    setBase(null);
    setLoading(true);
    setError(null);
    const repoParam = `repo=${encodeURIComponent(repoName)}`;
    const baseParam = baseRef ? `&base=${encodeURIComponent(baseRef)}` : '';
    apiFetch(`/api/sessions/${sessionId}/commits?${repoParam}${baseParam}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setCommits(data.commits || []);
          if (data.baseSha) {
            setBase({
              sha: data.baseSha,
              shortSha: data.baseShortSha || data.baseSha.slice(0, 7),
              ref: data.baseRef || '',
              message: data.baseMessage || '',
            });
          }
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sessionId, repoName, enabled, baseRef]);

  return { commits, base, loading, error };
}

function useCommitDiff(sessionId: string, repoName: string, sha: string | null, toSha?: string) {
  const [rawDiff, setRawDiff] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sha) { setRawDiff(''); return; }
    setLoading(true);
    const repoParam = `repo=${encodeURIComponent(repoName)}`;
    const toParam = toSha ? `&to=${toSha}` : '';
    apiFetch(`/api/sessions/${sessionId}/commits/${sha}/diff?${repoParam}${toParam}`)
      .then(r => r.json())
      .then(data => setRawDiff(data.raw || ''))
      .catch(() => setRawDiff(''))
      .finally(() => setLoading(false));
  }, [sessionId, repoName, sha, toSha]);

  return { rawDiff, loading };
}

// ─── Theme integration ───────────────────────────────────────────────────────────

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

function useEffectiveThemeType(): ThemeTypes {
  const { colorMode } = useTheme();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (colorMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [colorMode]);

  if (colorMode === 'dark') return 'dark';
  if (colorMode === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

function useDiffStyleOverrides(): CSSProperties {
  return useMemo(() => ({
    '--diffs-font-family': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    '--diffs-font-size': '13px',
    '--diffs-line-height': '20px',
    '--diffs-header-font-family': 'inherit',
    '--diffs-gap-inline': '6px',
    '--diffs-gap-block': '4px',
  } as CSSProperties), []);
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

// ─── Repo tab bar ─────────────────────────────────────────────────────────────────

function RepoTabBar({ repos, selected, onSelect }: {
  repos: { repoName: string; count: number }[];
  selected: string;
  onSelect: (repoName: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 shrink-0 overflow-x-auto">
      {repos.map(({ repoName, count }) => (
        <button
          key={repoName}
          onClick={() => onSelect(repoName)}
          className={`px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
            selected === repoName
              ? 'bg-background border border-border text-foreground font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          {repoName.includes('/') ? repoName.split('/').pop() : repoName}
          {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Per-file collapsed diff ─────────────────────────────────────────────────────

function useFullFileDiff(
  sessionId: string,
  repoName: string,
  partialFile: FileDiffMetadata,
  shouldFetch: boolean,
): { fileDiff: FileDiffMetadata; loading: boolean } {
  const [fullDiff, setFullDiff] = useState<FileDiffMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  // Reset when file or repo changes
  useEffect(() => {
    fetched.current = false;
    setFullDiff(null);
  }, [sessionId, repoName, partialFile.name]);

  useEffect(() => {
    if (!shouldFetch || fetched.current) return;
    fetched.current = true;
    setLoading(true);

    const repoParam = `repo=${encodeURIComponent(repoName)}`;
    apiFetch(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(partialFile.name)}&${repoParam}`)
      .then(r => r.json())
      .then(({ oldContent, newContent }: { oldContent: string; newContent: string }) => {
        try {
          const oldFile: FileContents = { name: partialFile.name, contents: oldContent || '' };
          const newFile: FileContents = { name: partialFile.name, contents: newContent || '' };
          setFullDiff(parseDiffFromFile(oldFile, newFile));
        } catch {
          setFullDiff(null);
        }
      })
      .catch(() => setFullDiff(null))
      .finally(() => setLoading(false));
  }, [sessionId, repoName, partialFile.name, shouldFetch]);

  return { fileDiff: fullDiff ?? partialFile, loading };
}

// Unified collapsed file diff — used in both working-tree changes (with sessionId/repoName for full-file fetch)
// and commit diffs (no sessionId, renders the parsed file directly).
function FileDiffCollapsed({ file, stats, rawDiff, sessionId, repoName, ...renderProps }: {
  file: FileDiffMetadata;
  stats: { additions: number; deletions: number };
  rawDiff: string;
  sessionId?: string;
  repoName?: string;
} & DiffRenderProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldFetch = expanded && !!sessionId;
  const { fileDiff, loading: fileLoading } = useFullFileDiff(
    sessionId ?? '',
    repoName ?? '',
    file,
    shouldFetch,
  );
  const { diffTheme, themeType, styleOverrides, diffStyle } = renderProps;

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
          <span>{formatRelativeTime(commit.date)}</span>
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

function CommitDiffView({ sessionId, repoName, commit, onBack, ...renderProps }: {
  sessionId: string;
  repoName: string;
  commit: CommitInfo;
  onBack: () => void;
} & DiffRenderProps) {
  const { rawDiff, loading } = useCommitDiff(sessionId, repoName, commit.sha);
  const files = useMemo(() => parseFilesFromDiff(rawDiff), [rawDiff]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button onClick={onBack} className="p-1 rounded-md hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{commit.message}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{commit.shortSha}</span>
            {' · '}{commit.author}
            {' · '}{formatRelativeTime(commit.date)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="text-emerald-500">+{commit.additions}</span>
          <span className="text-red-500">−{commit.deletions}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading commit diff...</div>
        ) : files.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No file changes in this commit</p>
        ) : (
          files.map(({ file, stats }) => (
            <FileDiffCollapsed
              key={file.name}
              file={file}
              stats={stats}
              rawDiff={rawDiff}
              {...renderProps}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RangeDiffView({ sessionId, repoName, base, onBack, ...renderProps }: {
  sessionId: string;
  repoName: string;
  base: BaseInfo;
  onBack: () => void;
} & DiffRenderProps) {
  const { rawDiff, loading } = useCommitDiff(sessionId, repoName, base.sha, 'HEAD');
  const files = useMemo(() => parseFilesFromDiff(rawDiff), [rawDiff]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button onClick={onBack} className="p-1 rounded-md hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">All changes from {base.ref || 'base'}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{base.shortSha}</span>
            {base.message && <> &middot; {base.message}</>}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading diff...</div>
        ) : files.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No changes from base</p>
        ) : (
          <>
            <DiffSummaryBar files={files} liveUpdating={false} />
            {files.map(({ file, stats }) => (
              <FileDiffCollapsed
                key={file.name}
                file={file}
                stats={stats}
                rawDiff={rawDiff}
                {...renderProps}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Per-repo Changes view ────────────────────────────────────────────────────────

function RepoChangesView({ repo, sessionId, liveUpdating, ...renderProps }: {
  repo: RepoDiff;
  sessionId: string;
  liveUpdating: boolean;
} & DiffRenderProps) {
  const files = useMemo(() => parseFilesFromDiff(repo.diff), [repo.diff]);

  if (files.length === 0) {
    return <p className="text-muted-foreground text-sm p-3">No uncommitted changes</p>;
  }

  return (
    <>
      <DiffSummaryBar files={files} liveUpdating={liveUpdating} />
      <div className="flex-1 overflow-auto">
        {files.map(({ file, stats }) => (
          <FileDiffCollapsed
            key={file.name}
            file={file}
            stats={stats}
            rawDiff={repo.diff}
            sessionId={sessionId}
            repoName={repo.repoName}
            {...renderProps}
          />
        ))}
      </div>
    </>
  );
}

// ─── Per-repo Commits view ────────────────────────────────────────────────────────

function RepoCommitsView({ sessionId, repoName, ...renderProps }: {
  sessionId: string;
  repoName: string;
} & DiffRenderProps) {
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [showRangeDiff, setShowRangeDiff] = useState(false);
  const [selectedBase, setSelectedBase] = useState('');
  const refs = useRefs(sessionId, repoName, true);

  // Derive effective base: user selection takes priority, then refs default.
  // Gate the fetch on refs being loaded so we always start with the right base.
  const effectiveBaseRef = selectedBase || refs?.defaultBase || '';
  const { commits, base, loading: commitsLoading, error: commitsError } = useCommitList(sessionId, repoName, !!refs, effectiveBaseRef);

  if (showRangeDiff && base) {
    return (
      <RangeDiffView
        sessionId={sessionId}
        repoName={repoName}
        base={base}
        onBack={() => setShowRangeDiff(false)}
        {...renderProps}
      />
    );
  }

  if (selectedCommit) {
    return (
      <CommitDiffView
        sessionId={sessionId}
        repoName={repoName}
        commit={selectedCommit}
        onBack={() => setSelectedCommit(null)}
        {...renderProps}
      />
    );
  }

  return (
    <>
      {refs && (refs.remote.length > 0 || refs.local.length > 0) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs shrink-0">
          <span className="text-muted-foreground whitespace-nowrap">Base:</span>
          <select
            value={effectiveBaseRef}
            onChange={(e) => setSelectedBase(e.target.value)}
            className="bg-muted/50 border border-border rounded px-2 py-1 text-xs font-mono min-w-0 max-w-[240px] truncate focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {refs.remote.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
            {refs.local.length > 0 && (
              <optgroup label="Local">
                {refs.local.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="text-muted-foreground">←</span>
          <span className="font-mono text-foreground">{refs.currentBranch}</span>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {commitsLoading ? (
          <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading commits...</div>
        ) : commitsError ? (
          <p className="text-muted-foreground text-sm p-3">{commitsError}</p>
        ) : commits.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No commits found</p>
        ) : (
          <>
            {base && (
              <button
                onClick={() => setShowRangeDiff(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border transition-colors bg-muted/20"
              >
                <GitCommit className="h-4 w-4 shrink-0 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">View all changes from base</p>
                  <p className="text-xs text-muted-foreground">
                    {base.ref && <><span className="font-mono">{base.ref}</span> &middot; </>}
                    <span className="font-mono">{base.shortSha}</span>
                    {base.message && <> &middot; {base.message}</>}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
            {commits.map(commit => (
              <CommitListItem
                key={commit.sha}
                commit={commit}
                onClick={() => setSelectedCommit(commit)}
              />
            ))}
            {base && (
              <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground border-b border-border">
                <div className="h-4 w-4 flex items-center justify-center shrink-0">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                </div>
                <span>
                  Base: <span className="font-mono">{base.ref || base.shortSha}</span>
                  {base.message && <> &mdash; {base.message}</>}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────

type DiffTab = 'changes' | 'commits';

export function DiffViewer({ sessionId, live = true, repos: externalRepos }: DiffViewerProps) {
  const fetched = useDiffData(sessionId, live && !externalRepos);
  const repos = externalRepos ?? fetched.repos;
  const loading = externalRepos ? false : fetched.loading;
  const liveUpdating = externalRepos ? false : fetched.liveUpdating;
  const { themeId } = useTheme();
  const isDesktop = useIsDesktop();
  const themeType = useEffectiveThemeType();
  const diffTheme = useMemo(() => getDiffsTheme(themeId), [themeId]);
  const styleOverrides = useDiffStyleOverrides();
  const diffStyle = isDesktop ? 'split' as const : 'unified' as const;

  const [tab, setTab] = useState<DiffTab>('changes');
  const [selectedRepo, setSelectedRepo] = useState('');

  const multiRepo = repos.length > 1;

  // Auto-select first repo when repos load
  useEffect(() => {
    if (repos.length > 0 && (!selectedRepo || !repos.find(r => r.repoName === selectedRepo))) {
      setSelectedRepo(repos[0].repoName);
    }
  }, [repos, selectedRepo]);

  const activeRepo = repos.find(r => r.repoName === selectedRepo) ?? repos[0];

  // NOTE(E2): repoCounts re-parses each repo's diff string independently here and again in
  // RepoChangesView. Avoiding this would require lifting the parsed files array up, which
  // adds prop-drilling complexity. The double-parse is cheap for typical diff sizes.
  const repoCounts = useMemo(() => repos.map(r => {
    try {
      const patches = parsePatchFiles(r.diff || '');
      const count = patches.reduce((n, p) => n + p.files.length, 0);
      return { repoName: r.repoName, count };
    } catch {
      return { repoName: r.repoName, count: 0 };
    }
  }), [repos]);

  const totalFiles = repoCounts.reduce((n, r) => n + r.count, 0);

  const sharedProps: DiffRenderProps = { diffTheme, themeType, styleOverrides, diffStyle };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
        <span className="animate-pulse">Loading changes...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main tab bar */}
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
          {totalFiles > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">{totalFiles}</span>
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
        </button>
        {liveUpdating && tab === 'changes' && (
          <span className="flex items-center gap-1.5 ml-auto mr-3 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Repo tab bar — only when >1 repo */}
      {multiRepo && activeRepo && (
        <RepoTabBar
          repos={repoCounts}
          selected={selectedRepo}
          onSelect={setSelectedRepo}
        />
      )}

      {/* Tab content */}
      {tab === 'changes' ? (
        repos.length === 0 ? (
          <p className="text-muted-foreground text-sm p-3">No uncommitted changes</p>
        ) : activeRepo ? (
          <RepoChangesView
            key={activeRepo.repoName}
            repo={activeRepo}
            sessionId={sessionId}
            liveUpdating={liveUpdating}
            {...sharedProps}
          />
        ) : null
      ) : (
        activeRepo ? (
          <RepoCommitsView
            key={activeRepo.repoName}
            sessionId={sessionId}
            repoName={activeRepo.repoName}
            {...sharedProps}
          />
        ) : null
      )}
    </div>
  );
}

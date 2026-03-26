# File System View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file tree browser to session panels and the Settings page, backed by two new REST endpoints sharing a single `readFsTree()` utility.

**Architecture:** A shared `readFsTree()` backend utility powers two endpoints — session-scoped (`/api/sessions/:id/fs`) and general (`/api/fs`). A single `FileTreeViewer` React component handles both modes. The session panel gets a new Files modal alongside the existing diff panel; Settings gets a new "Files" section rendered inline.

**Tech Stack:** Bun/Hono backend (TypeScript), React 18 + Tailwind frontend, `fs/promises` for directory reads, `homedir()` from `os` module for `~` resolution, `lucide-react` for icons.

---

## File Map

**Backend — new/modified:**
- Create: `backend/src/lib/fs-tree.ts` — `readFsTree()` utility, `FsEntry` type, exclude list
- Modify: `backend/src/routes/tasks.ts` — add `/sessions/:id/fs`, `/fs`, `/fs/file` routes; make `repo` optional on `/sessions/:id/file`

**Frontend — new/modified:**
- Create: `frontend/src/components/custom/file-tree-viewer.tsx` — `FileTreeViewer` component
- Modify: `frontend/src/components/custom/diff-viewer.tsx` — accept `repos` prop instead of fetching internally; export `RepoDiff` type or re-export from shared location
- Modify: `frontend/src/components/custom/session-mobile-header.tsx` — add `onFiles?` prop + `FolderTree` button
- Modify: `frontend/src/routes/sessions.$id.tsx` — add `filesOpen` state, lift diff fetch, wire `FileTreeViewer` modal
- Modify: `frontend/src/routes/settings.tsx` — add `'files'` section with `FileTreeViewer`

---

## Task 1: `readFsTree()` backend utility

**Files:**
- Create: `backend/src/lib/fs-tree.ts`

- [ ] **Step 1: Create `fs-tree.ts` with `FsEntry` type and `readFsTree()`**

```typescript
// backend/src/lib/fs-tree.ts
import { readdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';

export type FsEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;       // relative to the root passed to readFsTree
  size?: number;      // files only
  children?: FsEntry[]; // dirs only, populated when depth > 0
};

const EXCLUDE = new Set(['.git', 'node_modules', 'dist', '.cache']);

/**
 * Recursively reads a directory up to `depth` levels deep.
 * `root` is the absolute base used for path traversal guard and for
 * computing relative `path` values on each entry.
 * `relPath` is the path relative to `root` to read ('' = root itself).
 */
export async function readFsTree(
  root: string,
  relPath: string,
  depth: number,
): Promise<FsEntry[]> {
  const abs = resolve(join(root, relPath));

  // Traversal guard: resolved path must start with root
  if (!abs.startsWith(resolve(root))) {
    throw new Error('Path traversal detected');
  }

  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: FsEntry[] = [];

  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue;

    const entryAbs = join(abs, entry.name);
    const entryRel = relative(root, entryAbs);

    if (entry.isDirectory()) {
      const fsEntry: FsEntry = {
        name: entry.name,
        type: 'dir',
        path: entryRel,
      };
      if (depth > 0) {
        fsEntry.children = await readFsTree(root, entryRel, depth - 1);
      }
      result.push(fsEntry);
    } else if (entry.isFile()) {
      let size: number | undefined;
      try {
        const s = await stat(entryAbs);
        size = s.size;
      } catch { /* ignore */ }
      result.push({ name: entry.name, type: 'file', path: entryRel, size });
    }
  }

  // Sort: dirs first, then files, both alphabetical
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/backend
bun run --bun tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `fs-tree.ts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/fs-tree.ts
git commit -m "feat: add readFsTree() utility with path traversal guard"
```

---

## Task 2: Backend endpoints

**Files:**
- Modify: `backend/src/routes/tasks.ts`

- [ ] **Step 1: Add imports and `resolveSessionRoot()` helper at top of `tasks.ts`**

After the existing imports (around line 4), add `homedir` import and update the `path` import to include `resolve`. Add after the existing `resolveRepoCwd` function (around line 48):

```typescript
// Add to imports at top (also add `resolve` to the existing `path` import: `import { join, basename, resolve } from 'path';`)
import { homedir } from 'os';
import { readFsTree } from '../lib/fs-tree.ts';
import type { FsEntry } from '../lib/fs-tree.ts';

// Add after resolveRepoCwd function
/** Resolves the filesystem root for a session — uses session.meta.cwd directly. */
function resolveSessionRoot(sessionId: string): string | null {
  const session = db.getSession(sessionId);
  if (!session) return null;
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  return (meta.cwd as string | undefined) ?? null;
}
```

- [ ] **Step 2: Add `GET /sessions/:id/fs` endpoint**

Add after the existing `GET /sessions/:id/diff/stream` block (around line 160):

```typescript
// GET /sessions/:id/fs?path=&depth=
tasksRoutes.get('/sessions/:id/fs', async (c) => {
  const sessionId = c.req.param('id');
  const relPath = c.req.query('path') ?? '';
  const depth = Math.min(Number(c.req.query('depth') ?? 2), 5);

  const root = resolveSessionRoot(sessionId);
  if (!root) return c.json({ error: 'Session not found or has no cwd' }, 404);

  try {
    const entries = await readFsTree(root, relPath, depth);
    return c.json({ path: relPath, entries });
  } catch (err) {
    if ((err as Error).message === 'Path traversal detected') {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to read directory' }, 500);
  }
});
```

- [ ] **Step 3: Add `GET /fs` and `GET /fs/file` endpoints**

Add after the session fs endpoint:

```typescript
// GET /fs?path=&depth=  (general — root = ~)
tasksRoutes.get('/fs', async (c) => {
  const root = homedir();
  const relPath = c.req.query('path') ?? '';
  const depth = Math.min(Number(c.req.query('depth') ?? 2), 5);

  try {
    const entries = await readFsTree(root, relPath, depth);
    return c.json({ path: relPath, entries });
  } catch (err) {
    if ((err as Error).message === 'Path traversal detected') {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to read directory' }, 500);
  }
});

// GET /fs/file?path=  (general file read — path relative to ~, must stay under ~)
tasksRoutes.get('/fs/file', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'Missing path' }, 400);

  const root = homedir();
  const abs = resolve(join(root, filePath));
  if (!abs.startsWith(root)) return c.json({ error: 'Invalid path' }, 400);

  try {
    const content = await readFile(abs, 'utf-8');
    return c.json({ content });
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
});
```

- [ ] **Step 4: Make `repo` optional on `GET /sessions/:id/file`**

Find the existing handler (around line 167) and replace it:

```typescript
// GET /sessions/:id/file?path=...&repo=...
tasksRoutes.get('/sessions/:id/file', async (c) => {
  const sessionId = c.req.param('id');
  const filePath = c.req.query('path');
  const repoName = c.req.query('repo') ?? '';
  if (!filePath) return c.json({ error: 'Missing path query parameter' }, 400);

  // If repo provided, use git-aware resolution (existing behaviour)
  if (repoName) {
    const cwd = resolveRepoCwd(sessionId, repoName);
    if (!cwd) return c.json({ error: 'Session not found, no cwd, or invalid repo' }, 404);
    const git = simpleGit(cwd);
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) return c.json({ error: 'Not a git repository' }, 400);
    let oldContent = '';
    try { oldContent = await git.show([`HEAD:${filePath}`]); } catch { /* new file */ }
    let newContent = '';
    try { newContent = await readFile(join(cwd, filePath), 'utf-8'); } catch { /* deleted */ }
    return c.json({ oldContent, newContent });
  }

  // No repo — direct file read from session cwd, no git diff
  const root = resolveSessionRoot(sessionId);
  if (!root) return c.json({ error: 'Session not found or has no cwd' }, 404);
  let newContent = '';
  try { newContent = await readFile(join(root, filePath), 'utf-8'); } catch { /* missing */ }
  return c.json({ oldContent: '', newContent });
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/backend
bun run --bun tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Smoke test endpoints**

Start the backend in one terminal, run in another:

```bash
# Start backend
cd /home/exedev/.agemon/app/backend
AGEMON_KEY=test bun run src/server.ts

# In another terminal — test general fs endpoint
curl -s -H "Authorization: Bearer test" \
  "http://127.0.0.1:3000/api/fs?depth=1" | bun -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')), null, 2))"
```

Expected: JSON with `{ path: '', entries: [...] }` listing home dir.

```bash
# Test traversal guard
curl -s -H "Authorization: Bearer test" \
  "http://127.0.0.1:3000/api/fs?path=../../etc" | cat
```

Expected: `{"error":"Invalid path"}`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/tasks.ts backend/src/lib/fs-tree.ts
git commit -m "feat: add /sessions/:id/fs, /fs, /fs/file endpoints"
```

---

## Task 3: `FileTreeViewer` component

**Files:**
- Create: `frontend/src/components/custom/file-tree-viewer.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/custom/file-tree-viewer.tsx
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, ArrowLeft, Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/api';

export type FsEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;
  size?: number;
  children?: FsEntry[];
};

type RepoDiff = {
  repoName: string;
  cwd: string;
  diff: string;
};

type FileTreeViewerProps =
  | { mode: 'session'; sessionId: string; diffRepos?: RepoDiff[] }
  | { mode: 'fs' };

type FileView = { path: string; content: string; oldContent?: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiFetch(url: string) {
  return fetch(url, { headers: authHeaders(), credentials: 'include' });
}

function buildChangedPaths(diffRepos: RepoDiff[]): Set<string> {
  const changed = new Set<string>();
  for (const repo of diffRepos) {
    // Parse file paths from unified diff headers: "diff --git a/path b/path"
    const matches = repo.diff.matchAll(/^diff --git a\/(.+?) b\//gm);
    for (const m of matches) {
      // Path is relative to repo cwd; prepend repo dir name for matching tree paths
      changed.add(m[1]);
      changed.add(`${repo.repoName}/${m[1]}`);
    }
  }
  return changed;
}

function isAncestorOfAny(dirPath: string, changedPaths: Set<string>): boolean {
  for (const p of changedPaths) {
    if (p.startsWith(dirPath + '/') || p === dirPath) return true;
  }
  return false;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Tree Node ────────────────────────────────────────────────────────────────

function TreeNode({
  entry,
  treeMap,
  onExpand,
  fetching,
  changedPaths,
  filterChanged,
  onFileClick,
}: {
  entry: FsEntry;
  treeMap: Map<string, FsEntry[]>;
  onExpand: (entry: FsEntry) => void;
  fetching: Set<string>;
  changedPaths: Set<string>;
  filterChanged: boolean;
  onFileClick: (entry: FsEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  const isChanged = changedPaths.has(entry.path);
  const hasChangedDescendants = entry.type === 'dir' && isAncestorOfAny(entry.path, changedPaths);

  if (filterChanged && entry.type === 'file' && !isChanged) return null;
  if (filterChanged && entry.type === 'dir' && !hasChangedDescendants) return null;

  const children = treeMap.get(entry.path);
  const isFetching = fetching.has(entry.path);

  const handleDirClick = () => {
    if (!open && !children) onExpand(entry);
    setOpen(o => !o);
  };

  const dot = isChanged ? (
    <span className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0" />
  ) : null;

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
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
        {open
          ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
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
                  filterChanged={filterChanged}
                  onFileClick={onFileClick}
                />
              ))
            : !isFetching && (
                <div className="px-3 py-1 text-xs text-muted-foreground">Loading...</div>
              )
          }
        </div>
      )}
    </div>
  );
}

// ─── File Content View ────────────────────────────────────────────────────────

function FileContentView({
  fileView,
  onBack,
}: {
  fileView: FileView;
  onBack: () => void;
}) {
  const pathParts = fileView.path.split('/');

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
        {fileView.oldContent !== undefined ? (
          // Session mode: show as diff (green = new content, since we reuse the diff display pattern)
          <pre className="text-xs font-mono p-3 whitespace-pre-wrap leading-relaxed">
            {fileView.content.split('\n').map((line, i) => {
              const isAdded = fileView.oldContent === '' || !fileView.oldContent?.includes(line);
              return (
                <div
                  key={i}
                  className={fileView.oldContent === '' ? 'text-emerald-400' : ''}
                >
                  {line}
                </div>
              );
            })}
          </pre>
        ) : (
          // Settings mode: plain content
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

  const sessionId = props.mode === 'session' ? props.sessionId : null;
  const diffRepos = props.mode === 'session' ? (props.diffRepos ?? []) : [];

  const changedPaths = buildChangedPaths(diffRepos);

  const fsUrl = (relPath: string, depth = 2) =>
    sessionId
      ? `/api/sessions/${sessionId}/fs?path=${encodeURIComponent(relPath)}&depth=${depth}`
      : `/api/fs?path=${encodeURIComponent(relPath)}&depth=${depth}`;

  const fetchEntries = useCallback(async (relPath: string, depth = 2) => {
    const data = await apiFetch(fsUrl(relPath, depth)).then(r => r.json()) as { entries: FsEntry[] };
    return data.entries ?? [];
  }, [sessionId]);

  // Populate tree map from a flat entry list (with children pre-attached up to depth=2)
  const populateMap = useCallback((entries: FsEntry[], map: Map<string, FsEntry[]>, parentPath: string) => {
    map.set(parentPath, entries);
    for (const entry of entries) {
      if (entry.type === 'dir' && entry.children) {
        populateMap(entry.children, map, entry.path);
      }
    }
  }, []);

  // Initial load (depth=2)
  useEffect(() => {
    setLoading(true);
    fetchEntries('', 2).then(entries => {
      const map = new Map<string, FsEntry[]>();
      populateMap(entries, map, '');
      setTreeMap(map);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sessionId]);

  // Expand handler: background-fetch depth=2 for unfetched dirs
  const handleExpand = useCallback((entry: FsEntry) => {
    if (treeMap.has(entry.path)) return;
    setFetching(prev => new Set(prev).add(entry.path));
    fetchEntries(entry.path, 2).then(entries => {
      setTreeMap(prev => {
        const next = new Map(prev);
        populateMap(entries, next, entry.path);
        return next;
      });
      setFetching(prev => { const s = new Set(prev); s.delete(entry.path); return s; });
    }).catch(() => {
      setFetching(prev => { const s = new Set(prev); s.delete(entry.path); return s; });
    });
  }, [treeMap, fetchEntries, populateMap]);

  // File open
  const handleFileClick = useCallback(async (entry: FsEntry) => {
    if (sessionId) {
      const data = await apiFetch(
        `/api/sessions/${sessionId}/file?path=${encodeURIComponent(entry.path)}`
      ).then(r => r.json()) as { oldContent: string; newContent: string };
      setFileView({ path: entry.path, content: data.newContent, oldContent: data.oldContent });
    } else {
      // path is relative to home dir; backend /api/fs/file expects absolute path
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
      {/* Header */}
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

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
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
              filterChanged={filterChanged}
              onFileClick={handleFileClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/frontend
node_modules/.bin/tsc --noEmit 2>&1 | head -20
```

Expected: no errors in `file-tree-viewer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/custom/file-tree-viewer.tsx
git commit -m "feat: add FileTreeViewer component with lazy tree expansion"
```

---

## Task 4: Session header — Files button

**Files:**
- Modify: `frontend/src/components/custom/session-mobile-header.tsx`
- Modify: `frontend/src/components/custom/chat-panel.tsx`

- [ ] **Step 1: Add `onFiles` prop and `FolderTree` button to `SessionMobileHeader`**

Open `frontend/src/components/custom/session-mobile-header.tsx`. Add `FolderTree` to the lucide import and `onFiles` to the props:

```typescript
// Change line 1:
import { ArrowLeft, FileDiff, FolderTree, Square } from 'lucide-react';

// Add onFiles to the props destructuring and type:
export function SessionMobileHeader({
  sessionLabel,
  sessionState,
  sessionRunning,
  actionLoading,
  onBack,
  onStop,
  onDiff,
  onFiles,
}: {
  sessionLabel: string;
  sessionState: AgentSessionState;
  sessionRunning: boolean;
  actionLoading: boolean;
  onBack: () => void;
  onStop: () => void;
  onDiff?: () => void;
  onFiles?: () => void;
}) {
```

Then add the Files button after the existing diff button (after the `{onDiff && (...)}` block):

```typescript
{onFiles && (
  <Button size="icon" variant="ghost" aria-label="Browse files" onClick={onFiles} className="min-h-[44px] min-w-[44px] shrink-0">
    <FolderTree className="h-4 w-4" />
  </Button>
)}
```

- [ ] **Step 2: Thread `onFiles` through `ChatPanel`**

Open `frontend/src/components/custom/chat-panel.tsx`. Add `onFiles?: () => void` to `ChatPanelProps` and pass it to `SessionMobileHeader`. Find the line that reads:

```typescript
onDiff={onDiff}
```

And add `onFiles={onFiles}` on the next line. Also add `onFiles` to the props destructure and the `ChatPanelProps` type.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/frontend
node_modules/.bin/tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/custom/session-mobile-header.tsx \
        frontend/src/components/custom/chat-panel.tsx
git commit -m "feat: add Files button to session header"
```

---

## Task 5: Session route — Files modal + lift diff fetch

**Files:**
- Modify: `frontend/src/routes/sessions.$id.tsx`
- Modify: `frontend/src/components/custom/diff-viewer.tsx`

- [ ] **Step 1: Make `DiffViewer` accept optional `repos` prop**

Open `frontend/src/components/custom/diff-viewer.tsx`. Find the `DiffViewerProps` interface and `useDiffData` hook usage inside `DiffViewer`.

Change `DiffViewerProps` to accept an optional `repos` prop:

```typescript
interface DiffViewerProps {
  sessionId: string;
  live?: boolean;
  repos?: RepoDiff[]; // pre-fetched from parent; if provided, skips internal fetch
}
```

In the `DiffViewer` function body, change:

```typescript
const { repos, loading, liveUpdating } = useDiffData(sessionId, live);
```

to:

```typescript
const fetched = useDiffData(sessionId, live && !props.repos);
const repos = props.repos ?? fetched.repos;
const loading = props.repos ? false : fetched.loading;
const liveUpdating = props.repos ? false : fetched.liveUpdating;
```

Where `props` is the destructured parameter — rename the function signature accordingly:

```typescript
export function DiffViewer({ sessionId, live = true, repos: externalRepos }: DiffViewerProps) {
  const fetched = useDiffData(sessionId, live && !externalRepos);
  const repos = externalRepos ?? fetched.repos;
  const loading = externalRepos ? false : fetched.loading;
  const liveUpdating = externalRepos ? false : fetched.liveUpdating;
  // ... rest unchanged
```

- [ ] **Step 2: Wire `sessions.$id.tsx` with Files modal**

Replace the full content of `frontend/src/routes/sessions.$id.tsx`:

```typescript
/**
 * Standalone session detail view — fullscreen chat, no task wrapper.
 * Route: /sessions/:id
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChatPanel } from '@/components/custom/chat-panel';
import { DiffViewer } from '@/components/custom/diff-viewer';
import { FileTreeViewer } from '@/components/custom/file-tree-viewer';
import { useWsStore } from '@/lib/store';
import { useEffect, useState } from 'react';
import { authHeaders } from '@/lib/api';
import type { RepoDiff } from '@/components/custom/diff-viewer';

export default function SessionDetailPage() {
  const { id: sessionId } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [diffOpen, setDiffOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [repos, setRepos] = useState<RepoDiff[]>([]);

  const setHostLayout = useWsStore((s) => s.setHostLayout);
  useEffect(() => {
    setHostLayout('fullscreen');
    return () => { setHostLayout('default'); };
  }, [setHostLayout]);

  // Fetch diff repos when either panel opens (shared between diff + files)
  useEffect(() => {
    if (!diffOpen && !filesOpen) return;
    fetch(`/api/sessions/${sessionId}/diff`, { headers: authHeaders(), credentials: 'include' })
      .then(r => r.json())
      .then((data: { repos?: RepoDiff[] }) => setRepos(data.repos ?? []))
      .catch(() => {});
  }, [diffOpen, filesOpen, sessionId]);

  const handleBack = () => {
    navigate({ to: '/sessions', search: { taskId: undefined } });
  };

  const modalClass = 'fixed inset-4 z-50 bg-background border rounded-lg shadow-xl flex flex-col';

  return (
    <div className="flex flex-col h-dvh">
      <ChatPanel
        sessionId={sessionId}
        onBack={handleBack}
        onDiff={() => setDiffOpen(true)}
        onFiles={() => setFilesOpen(true)}
      />

      {diffOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setDiffOpen(false)} />
          <div className={modalClass}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h2 className="text-sm font-semibold">Changes</h2>
              <button onClick={() => setDiffOpen(false)} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center">✕</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DiffViewer sessionId={sessionId} repos={repos} />
            </div>
          </div>
        </>
      )}

      {filesOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setFilesOpen(false)} />
          <div className={modalClass}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h2 className="text-sm font-semibold">Files</h2>
              <button onClick={() => setFilesOpen(false)} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center">✕</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <FileTreeViewer mode="session" sessionId={sessionId} diffRepos={repos} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

Note: `RepoDiff` needs to be exported from `diff-viewer.tsx`. Add `export` to the `RepoDiff` interface in that file:

```typescript
export interface RepoDiff {
  repoName: string;
  cwd: string;
  diff: string;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/frontend
node_modules/.bin/tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/sessions.\$id.tsx \
        frontend/src/components/custom/diff-viewer.tsx
git commit -m "feat: add Files modal to session view, lift diff fetch to route level"
```

---

## Task 6: Settings — Files section

**Files:**
- Modify: `frontend/src/routes/settings.tsx`

- [ ] **Step 1: Add `FileTreeViewer` to Settings**

Open `frontend/src/routes/settings.tsx`.

Add import at top:

```typescript
import { FileTreeViewer } from '@/components/custom/file-tree-viewer';
import { FolderTree } from 'lucide-react';
```

Change the `Section` type (line 17):

```typescript
type Section = 'appearance' | 'mcp-servers' | 'skills' | 'extensions' | 'files' | 'about';
```

Add to `SECTIONS` array (after `extensions`, before `about`):

```typescript
{ id: 'files', label: 'Files', icon: FolderTree },
```

Add `FilesSection` component (before the `SettingsPage` export):

```typescript
function FilesSection() {
  return (
    <section className="space-y-4 h-full flex flex-col">
      <div>
        <h2 className="text-sm font-semibold">Files</h2>
        <p className="text-xs text-muted-foreground mt-1">Browse the server filesystem.</p>
      </div>
      <div className="flex-1 border rounded-lg overflow-hidden min-h-[400px]">
        <FileTreeViewer mode="fs" />
      </div>
    </section>
  );
}
```

Add the section render in the content area (alongside the other `activeSection === ...` checks):

```typescript
{activeSection === 'files' && <FilesSection />}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/exedev/.agemon/app/frontend
node_modules/.bin/tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/settings.tsx
git commit -m "feat: add Files section to settings"
```

---

## Task 7: End-to-end smoke test

- [ ] **Step 1: Start backend**

```bash
cd /home/exedev/.agemon/app/backend
AGEMON_KEY=test bun run src/server.ts
```

- [ ] **Step 2: Start frontend dev server**

```bash
cd /home/exedev/.agemon/app/frontend
bun run dev
```

- [ ] **Step 3: Open Settings → Files**

Navigate to Settings in the UI. Verify "Files" tab appears in the sidebar/tab bar. Click it. Verify the file tree loads and shows `~` contents. Expand a directory. Verify background fetch works (spinner shows briefly, then children appear). Click a file. Verify plain content shows with back button.

- [ ] **Step 4: Open a session → Files button**

Open any session that has been run. Tap the `FolderTree` icon in the header. Verify Files modal opens. Verify tree loads the session cwd. Toggle "Changed only" (if session has diffs) — verify filtered view. Click a file — verify content with diff highlighting.

- [ ] **Step 5: Verify traversal guard**

```bash
curl -s -H "Authorization: Bearer test" \
  "http://127.0.0.1:3000/api/fs?path=../../etc" | cat
# Expected: {"error":"Invalid path"}

curl -s -H "Authorization: Bearer test" \
  "http://127.0.0.1:3000/api/fs/file?path=/etc/passwd" | cat
# Expected: {"error":"Invalid path"}
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: file system view — backend + frontend complete"
```

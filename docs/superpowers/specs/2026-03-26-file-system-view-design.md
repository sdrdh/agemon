# File System View — Design Spec

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

A file tree browser surfaced in three places: the session panel (alongside the existing diff viewer), and the Settings page. The core component is `FileTreeViewer` — a single reusable component that accepts either a session context or a general root path.

Tasks are an extension and are not referenced in core. The session's `cwd` is the root for all session-scoped browsing.

---

## Entry Points

| Surface | Trigger | Root | Diff filter |
|---|---|---|---|
| Session header | `FolderTree` icon button next to `FileDiff` icon | `session.meta.cwd` | Yes — overlays existing diff data |
| Settings → Files section | New sidebar/tab entry | `~` (server home) | No |

---

## Backend

### New: `GET /api/sessions/:id/fs?path=&depth=2`

- `path` — relative to `session.meta.cwd`. Defaults to `''` (root).
- `depth` — how many levels to return recursively. Defaults to `2`.
- Resolves root from `session.meta.cwd`. Returns 404 if session not found or has no cwd.
- Path traversal guard: reject any resolved path outside the session root.
- Excludes: `.git/`, `node_modules/`, `dist/`, `.cache/`.
- Response:

```ts
type FsEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;       // relative to session root
  size?: number;      // files only
  children?: FsEntry[]; // dirs only, if depth > 0
}

// GET /api/sessions/:id/fs
{ path: string, entries: FsEntry[] }
```

### New: `GET /api/fs?path=&depth=2`

- Same shape as above, no session required.
- `path` is absolute. Root defaults to `~` (server home dir). No restriction — full filesystem access.
- Same excludes apply.

### Modified: `GET /api/sessions/:id/file?path=`

- `repo` param becomes optional.
- If `repo` is omitted, the backend reads the file directly from `join(session.meta.cwd, path)` with no git context → returns `{ oldContent: '', newContent: <file content> }`.
- If `repo` is provided (or derivable from the path's first segment matching a known repo dir), runs the existing git diff logic.

### New: `GET /api/fs/file?path=`

- Read-only file content, no git context. Returns `{ content: string }`.
- Used by the settings filesystem view.
- Path is absolute. Reject paths outside `~`.

---

## Frontend

### `FileTreeViewer` component

```ts
// Session-scoped (with diff filter capability)
<FileTreeViewer mode="session" sessionId={id} diffRepos={repos} />

// General (settings)
<FileTreeViewer mode="fs" />
```

**Tree state:** `Map<path, FsEntry[]>` — entries per directory path, keyed by relative path from root.

**Loading strategy:**
1. On mount: fetch `depth=2` from root. Populate map.
2. When user expands a dir not yet in the map: fire background fetch (`depth=2` from that dir). Show a subtle spinner on that node. Never block expand interaction.
3. Pre-populate children from the initial fetch so first two levels expand instantly.

**"Changed only" toggle** (session mode only):
- Derives changed paths from `diffRepos` prop (already loaded by parent — no extra fetch).
- When active: filter tree to show only files present in the diff + their ancestor directories.
- Changed file dot badges: `#22c55e` added, `#f59e0b` modified, `#ef4444` deleted.
- Toggle is a pill button in the panel header.

**File open:**
- Tapping a file shows an in-panel file content view.
- Session mode: fetches `/api/sessions/:id/file?path=` → renders via existing `FileDiff` component with full diff highlighting.
- Settings mode: fetches `/api/fs/file?path=` → renders plain file content (syntax-highlighted, no diff).
- A back arrow in the header returns to the tree.
- Breadcrumb shows current path, each segment is tappable to navigate up.

**Excludes display:** Directories matching the exclude list (`.git/`, `node_modules/`, etc.) are hidden entirely — not shown as collapsed.

---

## Session Panel Integration

`SessionMobileHeader` gains an `onFiles?: () => void` prop. When provided, renders a `FolderTree` icon button (44×44px) next to the existing `FileDiff` button.

`sessions.$id.tsx` adds `filesOpen` state alongside `diffOpen`. Opens a modal overlay (same `fixed inset-4 z-50` pattern as the diff panel) containing `<FileTreeViewer mode="session" sessionId={sessionId} diffRepos={repos} />`.

The diff data (`repos`) needs to be fetched at the `sessions.$id.tsx` level (not inside `DiffViewer`) so both panels can share it. `DiffViewer` and `FileTreeViewer` both receive `repos` as a prop. If neither panel is open, diff data is not fetched.

---

## Settings Integration

`Section` type gains `'files'`. `SECTIONS` array gains `{ id: 'files', label: 'Files', icon: FolderTree }`.

A `FilesSection` component renders `<FileTreeViewer mode="fs" />` inline within the settings content area — no modal, same layout as every other section.

---

## Shared `readFsTree()` function

Both backend endpoints call a single internal function:

```ts
async function readFsTree(root: string, relPath: string, depth: number): Promise<FsEntry[]>
```

- Resolves `join(root, relPath)`, guards against traversal outside `root`.
- Reads directory, stats each entry, recurses if `depth > 0` and entry is a dir.
- Applies exclude list.
- Returns sorted: dirs first, then files, both alphabetical.

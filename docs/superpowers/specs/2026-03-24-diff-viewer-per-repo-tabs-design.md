# Diff Viewer: Per-Repo Tabs + Contract Fixes

**Date:** 2026-03-24
**Status:** Approved

## Problem

Three related issues with the current diff viewer implementation:

1. **Hollow `SessionMeta` in `getDiffFromProvider`** — task-level diff routes call `provider.getDiff({ sessionId: '', agentType: '', meta })`. This works only by coincidence (all providers ignore `sessionId`/`agentType`). Future providers that read `sessionId` will silently receive an empty string.

2. **`resolveSessionCwd` returns task dir, not repo root** — for git-worktree sessions, `meta_json.cwd` is `~/.agemon/tasks/{taskId}/`, not a git repo. `simpleGit(cwd)` on the task dir fails for file/refs/commits endpoints.

3. **No per-repo grouping in the UI** — the plan acceptance criterion requires tabs per repo when multiple repos have changes. Currently a flat file list is shown.

These three problems share a single root cause: `getDiff` returns an opaque `string` with no structure. Fixing the return type fixes all three.

---

## Design

### Core change: `RepoDiff` type

A new structured type replaces the flat `string` returned by `getDiff`:

```typescript
interface RepoDiff {
  repoName: string;  // "acme/web", or directory basename for cwd-based sessions
  cwd: string;       // absolute path to git repo root for this diff
  diff: string;      // unified diff string (may be empty)
}
```

This lives in `backend/src/lib/plugins/workspace.ts` alongside the provider interface.

### `WorkspaceProvider.getDiff` signature

Only `getDiff` changes signature. `cleanup`, `contextSections`, and `guidelinesSections` keep `SessionMeta` — they run in the context of a real live session and legitimately use `sessionId` and `agentType`.

**Before:**
```typescript
getDiff?(session: SessionMeta): Promise<string | null>
```

**After:**
```typescript
getDiff?(meta: Record<string, unknown>): Promise<RepoDiff[] | null>
```

`SessionMeta` was never needed for `getDiff` — all implementations only read `session.meta`. Removing it eliminates the hollow wrapper.

### `workspace-default.ts` (git-worktree provider)

`getDiff` returns one `RepoDiff` per `task.repos`:

```typescript
async getDiff(meta): Promise<RepoDiff[] | null> {
  const taskId = meta.task_id as string;
  // ...
  for (const repo of task.repos) {
    const cwd = gitManager.getWorktreePath(taskId, repo.name);
    const diff = await gitManager.getDiff(taskId, repo.name);
    results.push({ repoName: repo.name, cwd, diff: diff ?? '' });
  }
  return results;
}
```

### Backend routes (`tasks.ts`)

**Diff endpoints** return `{ repos: RepoDiff[] }` instead of `{ raw: string }`:
- `GET /sessions/:id/diff`
- `GET /sessions/:id/diff/stream` — SSE events emit `{ repos }`
- `GET /tasks/:id/diff`
- `GET /tasks/:id/diff/stream` — SSE events emit `{ repos }`

The flat `{ raw }` shape is removed entirely (nothing outside the diff viewer consumes it).

**`resolveSessionCwd` → `resolveRepoCwd(sessionId, repoName): string | null`**

```typescript
function resolveRepoCwd(sessionId: string, repoName: string): string | null {
  const session = db.getSession(sessionId);
  if (!session) return null;
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const taskId = meta.task_id as string | undefined;
  if (taskId) {
    // Task session: repoName maps to a known worktree path via gitManager
    return gitManager.getWorktreePath(taskId, repoName);
  }
  // Standalone cwd session: by definition single-repo; ignore repoName
  return (meta.cwd as string) ?? null;
}
```

`repoName` is only meaningful for task sessions. Standalone `cwd` sessions are single-repo by definition — the `?repo=` param is accepted but ignored, and `meta.cwd` is always returned.

Callers must pass a real `repoName` for task sessions (never an empty string), since `getWorktreePath(taskId, '')` would resolve to the task directory root, not a repo.

**File/refs/commits endpoints** gain a required `?repo=` query param:
- `GET /sessions/:id/file?path=&repo=`
- `GET /sessions/:id/refs?repo=`
- `GET /sessions/:id/commits?repo=&base=`
- `GET /sessions/:id/commits/:sha/diff?repo=`

Each calls `resolveRepoCwd(sessionId, repo)`. Return 400 if `repo` is empty for a task session.

**Source of truth for repos:** `task.repos` (the DB field) is authoritative in `getDiff`. The `workspace_json.config` may also contain repo info but `task.repos` is what the session store indexes on and is always populated when repos are attached.

**Streaming JSON.parse safety** — wrap `JSON.parse(task.workspace_json)` in try/catch inside both streaming `start()` callbacks (issue #3 fix).

### Frontend (`diff-viewer.tsx`)

**`useDiffData`** is updated: returns `repos: RepoDiff[]` instead of `rawDiff: string`.

**`DiffViewer` — Changes tab**

- Single repo: no repo tabs, file list as before (no regression).
- Multiple repos: a secondary tab bar appears between the main tab bar and file list. Each repo tab shows `repoName` and its file count. Selected repo's files are shown.

The `repoName` is passed down to `FileDiffCollapsed`, which forwards it to:
- `useFullFileDiff` → `fetch('/api/sessions/:id/file?path=&repo=')`

**`DiffViewer` — Commits tab**

- Single repo: same as current.
- Multiple repos: same secondary repo tab bar. `useCommitList`, `useRefs`, and `useCommitDiff` all pass `?repo=` to their endpoints.
- Switching repo tabs resets `selectedBase`, `selectedCommit`, and `showRangeDiff` to their initial values — commits and SHAs are repo-specific and must not carry over.

**`DiffSummaryBar`** shows counts for the currently selected repo only (not an aggregate). This is consistent with the file list being scoped to the selected repo.

**React fixes (issues #4–#7)**

| Issue | Fix |
|-------|-----|
| `useFullFileDiff` re-runs after success | Remove `fullDiff` from `useEffect` deps; add a stable `useRef<boolean>` (`fetched`) that is set to `true` after the first fetch attempt (success or failure) to prevent any re-fetch |
| `useEffectiveThemeType` uses DOM MutationObserver | Replace with `useTheme()` from existing theme context |
| `useDiffStyleOverrides` lists unused `themeType` dep | Remove `themeType` from `useMemo` deps |
| `DiffViewer` in `page.tsx` always uses `live=true` | Pass `live={!isDone}` using `TaskDetail.status` |

---

## Scope

Not in scope for this change:
- Persisting which repo tab was last selected
- Cross-repo "all changes" aggregate view (can be added later)
- The `cwd` workspace provider implementation itself (only the interface changes; the default impl is updated)

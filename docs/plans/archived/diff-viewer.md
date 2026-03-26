# Diff Viewer Plan

## Overview

Add a read-only diff viewer that workspace providers can expose, exposed to plugins via PluginKit.

## Goals

- Lightweight diff endpoint calling workspace provider's `getDiff()`
- DiffViewer component exposed via PluginKit for plugin use
- Reusable across git-worktree, jj-workspace, or any VCS-backed provider

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Plugin (tasks) │     │  Backend         │     │  Frontend       │
├─────────────────┤     ├──────────────────┤     ├─────────────────┤
│ PluginKit.DiffViewer │──▶│ GET /tasks/:id/diff │──▶│ @pierre/diffs   │
│                     │     │                  │     │                 │
│                     │     │ workspaceProvider.getDiff() │     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Step 1: Backend - Diff Endpoint

**File:** `backend/src/routes/tasks.ts`

```typescript
import { parse } from '@pierre/diffs';
import { db } from '../../db/client.ts';
import { workspaceRegistry } from '../plugins/workspace-registry.ts';

// GET /tasks/:id/diff — returns diff for viewing changes
app.get('/tasks/:id/diff', async (c) => {
  const taskId = c.req.param('id');
  const format = c.req.query('format') || 'unified';

  const task = db.getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const workspace = task.workspace_json 
    ? JSON.parse(task.workspace_json) 
    : { provider: 'git-worktree', config: {} };

  const provider = workspaceRegistry.get(workspace.provider);
  
  if (!provider?.getDiff) {
    return c.json({ error: 'Workspace provider does not support diff' }, 400);
  }

  const diff = await provider.getDiff({
    sessionId: '',
    agentType: '',
    meta: { task_id: taskId, ...workspace.config },
  });

  if (!diff) return c.json({ changes: [] });

  if (format === 'structured') {
    const parsed = parse(diff);
    
    const byRepo = new Map<string, { path: string; additions: number; deletions: number }[]>();
    for (const file of parsed) {
      const repo = file.path.split('/')[0] || 'root';
      const existing = byRepo.get(repo) || [];
      existing.push({ path: file.path, additions: file.additions, deletions: file.deletions });
      byRepo.set(repo, existing);
    }

    const repos = Array.from(byRepo.entries()).map(([name, files]) => ({
      name,
      files,
    }));

    return c.json({ repos, raw: diff });
  }

  return c.text(diff || '');
});

// SSE /tasks/:id/diff/stream — streams diff updates in real-time
app.get('/tasks/:id/diff/stream', async (c) => {
  const taskId = c.req.param('id');
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      const sendUpdate = async () => {
        try {
          const task = db.getTask(taskId);
          if (!task) {
            controller.enqueue(encoder.encode(`event: error\ndata: Task not found\n\n`));
            return;
          }

          const workspace = task.workspace_json 
            ? JSON.parse(task.workspace_json) 
            : { provider: 'git-worktree', config: {} };

          const provider = workspaceRegistry.get(workspace.provider);
          
          if (!provider?.getDiff) {
            controller.enqueue(encoder.encode(`event: error\ndata: Provider does not support diff\n\n`));
            return;
          }

          const diff = await provider.getDiff({
            sessionId: '',
            agentType: '',
            meta: { task_id: taskId, ...workspace.config },
          });

          if (!diff) {
            controller.enqueue(encoder.encode(`event: diff\ndata: {}\n\n`));
            return;
          }

          const parsed = parse(diff);
          
          const byRepo = new Map<string, { path: string; additions: number; deletions: number }[]>();
          for (const file of parsed) {
            const repo = file.path.split('/')[0] || 'root';
            const existing = byRepo.get(repo) || [];
            existing.push({ path: file.path, additions: file.additions, deletions: file.deletions });
            byRepo.set(repo, existing);
          }

          const repos = Array.from(byRepo.entries()).map(([name, files]) => ({
            name,
            files,
          }));

          const payload = JSON.stringify({ repos, raw: diff });
          controller.enqueue(encoder.encode(`event: diff\ndata: ${payload}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${err.message}\n\n`));
        }
      };

      // Send initial diff
      sendUpdate();

      // Poll every 2 seconds while sessions are running
      const pollInterval = setInterval(async () => {
        const sessions = db.listSessions(taskId);
        const hasRunning = sessions.some(s => s.state === 'running' || s.state === 'ready');
        
        if (!hasRunning) {
          clearInterval(pollInterval);
          controller.enqueue(encoder.encode(`event: done\ndata: \n\n`));
          return;
        }
        
        sendUpdate();
      }, 2000);

      // Cleanup on disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
```

---

## Step 2: PluginKit - Add DiffViewer Component

**File:** `shared/types/plugin-kit.ts`

```typescript
export interface PluginKit {
  // ... existing

  /** Renders a diff viewer for a task's changes */
  DiffViewer: ReactComponent<{
    taskId: string;
    /** Show side-by-side on desktop, unified on mobile */
    defaultView?: 'unified' | 'split';
  }>;
}
```

---

## Step 3: Frontend - DiffViewer Component

**File:** `frontend/src/components/custom/diff-viewer.tsx`

```typescript
import { useMemo, useState, useEffect, useRef } from 'react';
import { parse, FileDiff as DiffFile } from '@pierre/diffs';

interface DiffViewerProps {
  taskId: string;
  defaultView?: 'unified' | 'split';
  /** Use SSE for real-time updates while agent is running */
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

export function DiffViewer({ taskId, defaultView = 'unified', live = true }: DiffViewerProps) {
  const [repos, setRepos] = useState<RepoGroup[]>([]);
  const [rawDiff, setRawDiff] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveUpdating, setLiveUpdating] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Use SSE if live=true (default), otherwise use one-shot fetch
    if (!live) {
      fetchOnce();
      return;
    }

    const eventSource = new EventSource(`/api/tasks/${taskId}/diff/stream`);
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

    eventSource.addEventListener('error', (event) => {
      console.error('SSE error:', event);
      setLiveUpdating(false);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [taskId, live]);

  async function fetchOnce() {
    try {
      const res = await fetch(`/api/tasks/${taskId}/diff?format=structured`);
      const data = await res.json();
      setRepos(data.repos || []);
      setRawDiff(data.raw || '');
    } catch (err) {
      console.error('Failed to fetch diff:', err);
    } finally {
      setLoading(false);
    }
  }

  // Parse raw diff for selected file
  const selectedFileDiff = useMemo(() => {
    if (!selectedFile || !rawDiff) return null;
    const parsed = parse(rawDiff);
    return parsed.find((f: DiffFile) => f.path === selectedFile) || null;
  }, [selectedFile, rawDiff]);

  // Auto-detect mobile
  const viewType = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'unified';
    }
    return defaultView;
  }, [defaultView]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <span className="animate-pulse">Loading changes...</span>
        {liveUpdating && <span className="text-xs">(live)</span>}
      </div>
    );
  }

  if (repos.length === 0) {
    return <p className="text-muted-foreground text-sm">No changes</p>;
  }

  return (
    <div className="diff-viewer flex flex-col h-full">
      {/* Status bar */}
      {liveUpdating && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground border-b border-border">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Updating...
        </div>
      )}

      {/* Repo Tabs */}
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

      {/* File List */}
      {!selectedFile && (
        <div className="flex-1 overflow-auto divide-y divide-border">
          {repos.flatMap(({ name, files }) =>
            files.map((file) => (
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
            ))
          )}
        </div>
      )}

      {/* File Diff */}
      {selectedFile && selectedFileDiff && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b border-border"
          >
            ← Back to file list
          </button>
          <div className="flex-1 overflow-auto">
            <FileDiff file={selectedFileDiff} viewType={viewType} />
          </div>
        </div>
      )}
    </div>
  );
}
```

### UI Layout

```
┌────────────────────────────────────────┐
│ [repo1] [repo2] [repo3]    (tabs)      │
├────────────────────────────────────────┤
│ src/index.ts              +12 -3       │ ← file list
│ src/utils.ts               +5 -1       │
│ src/components/Button.tsx  +20 -5      │
│ package.json                +1 -1      │
└────────────────────────────────────────┘

Click file →

┌────────────────────────────────────────┐
│ ← Back to file list                    │
├────────────────────────────────────────┤
│ @@ -1,5 +1,7 @@                       │
│  import { useState } from 'react';     │
│ -const OLD = 'old';                    │
│ +const NEW = 'new';                    │
│ +import { newFeature } from './new';    │
│  export function App() {                │
│   ...                                   │
└────────────────────────────────────────┘
```

---

## Step 4: Plugin Page Integration

**File:** `frontend/src/routes/plugin.tsx`

```typescript
import { DiffViewer } from '@/components/custom/diff-viewer';

// ... in pluginKit object
const pluginKit: PluginKit = {
  // ... existing
  DiffViewer,
};
```

---

## Step 5: Implement getDiff in git-worktree Provider

**File:** `backend/src/lib/plugins/workspace-default.ts`

```typescript
import { GitWorktreeManager } from '../git.ts';

export const defaultTaskWorkspaceProvider: WorkspaceProvider = {
  // ... existing prepare()

  async getDiff(session: SessionMeta): Promise<string | null> {
    const taskId = session.meta.task_id as string;
    if (!taskId) return null;

    const git = GitWorktreeManager.getInstance();
    const task = db.getTask(taskId);
    if (!task?.repos) return null;

    // Run git diff across all worktrees
    const diffs: string[] = [];
    for (const repo of task.repos) {
      const worktreePath = git.getWorktreePath(taskId, repo.name);
      try {
        const diff = await git.getDiff(taskId, repo.name);
        if (diff) diffs.push(diff);
      } catch {
        // Skip repos where diff fails
      }
    }

    return diffs.join('\n');
  },
};
```

---

## Step 5b: Implement getDiff in cwd Provider

The cwd provider should check if the cwd (or any immediate subdirectory) is a git repo and return diff if so.

**File:** `backend/src/server.ts`

```typescript
import { simpleGit } from 'simple-git';

// cwd: run in any local directory, no git setup required
workspaceRegistry.register('cwd', {
  async prepare(session) {
    const cwd = session.meta.cwd as string | undefined;
    if (!cwd) throw new Error('[workspace:cwd] session.meta.cwd is required');
    if (!(await stat(cwd).then(() => true).catch(() => false)))
      throw new Error(`[workspace:cwd] directory not found: ${cwd}`);
    return { cwd };
  },

  async getDiff(session: SessionMeta): Promise<string | null> {
    const cwd = session.meta.cwd as string | undefined;
    if (!cwd) return null;

    // Check if cwd itself is a git repo
    const git = simpleGit(cwd);
    const isRepo = await git.checkIsRepo().catch(() => false);
    
    if (isRepo) {
      const diff = await git.diff(['--', '.']);
      return diff || null;
    }

    // Check immediate children for git repos
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
    const subrepoDiffs: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subpath = join(cwd, entry.name);
        const subgit = simpleGit(subpath);
        const isSubrepo = await subgit.checkIsRepo().catch(() => false);
        
        if (isSubrepo) {
          const diff = await subgit.diff(['--', '.']).catch(() => '');
          if (diff) subrepoDiffs.push(`\n### ${entry.name}\n\n${diff}`);
        }
      }
    }

    return subrepoDiffs.length > 0 ? subrepoDiffs.join('\n') : null;
  },
});
```

---

## Step 6: Tasks Extension - Add "View Changes" Button

**File:** `extensions/tasks/renderers/page.tsx`

```typescript
// In task detail view
const handleViewDiff = async () => {
  const res = await fetch(`/api/tasks/${taskId}/diff`);
  if (!res.ok) {
    setError('Failed to load diff');
    return;
  }
  const diff = await res.text();
  setCurrentDiff(diff);
};

// Show DiffViewer in modal or drawer
{currentDiff && (
  <PluginKit.DiffViewer diff={currentDiff} defaultView="unified" />
)}
```

---

## Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `@pierre/diffs` | frontend | Diff parsing + rendering |
| `@pierre/diffs/react` | frontend | React components |
| `@pierre/diffs/react` | frontend | Optional: worker for offloading |

---

## Files to Create/Modify

### New files
- `frontend/src/components/custom/diff-viewer.tsx`

### Modify
- `shared/types/plugin-kit.ts` — add DiffViewer to interface
- `frontend/src/routes/plugin.tsx` — provide DiffViewer in PluginKit
- `backend/src/lib/plugins/workspace-default.ts` — implement getDiff
- `backend/src/routes/tasks.ts` — add GET /tasks/:id/diff endpoint
- `extensions/tasks/renderers/page.tsx` — add "View Changes" button

---

## Acceptance Criteria

- [ ] GET /tasks/:id/diff returns raw unified diff from workspace provider
- [ ] git-worktree provider returns diff from all worktrees
- [ ] cwd provider returns diff if cwd or any immediate child is a git repo
- [ ] PluginKit.DiffViewer renders diff with @pierre/diffs
- [ ] Tabs for each repository (if multiple repos have changes)
- [ ] File list with path and +/- line counts
- [ ] Click file → render full diff for that file
- [ ] Mobile shows unified view, desktop defaults to split
- [ ] Tasks plugin shows "View Changes" button when diff is available
- [ ] Fallback to raw `<pre>` if diff rendering fails

---

## Out of Scope (deferred)

- No approve/reject flow (agents handle commits)
- No DB storage of diffs
- No PR creation from diff view
## Phase 6: Diff Viewer (Week 6) → **Done**

**Goal:** Show changed files for context — no DB storage, no approve/reject flow

> **Rationale:** Agents handle their own git operations. The old Phase 6 (diff generation → DB storage → approve/reject → commit/push) is redundant. Instead, provide a lightweight read-only view of `git diff` output so users can see what changed at a glance.

### Task 6.1: Lightweight Diff Viewer

**Priority:** P2
**Status:** Done
**Estimated Time:** 8 hours

**Deliverables:**
- [x] Backend endpoints: `GET /sessions/:id/diff` and `GET /sessions/:id/diff/stream` (SSE) — all diff access is session-scoped; task sessions resolve through the task's workspace provider

- [x] Frontend: diff viewer component with syntax-highlighted diff via @pierre/diffs
- [x] Collapsible file sections (click to expand/collapse)
- [x] "View Changes" button on task detail page and session detail page
- [x] PluginKit exposes DiffViewer for use by plugins

**Technical Details:**
- Uses `@pierre/diffs` and `@pierre/diffs/react` for rendering
- Workspace provider `getDiff()` method returns raw diff string
- Both `git-worktree` and `cwd` providers implement `getDiff`
- DiffViewer shows file list with +/- counts, expandable to show full diff
- PierreFileDiff handles collapsed context lines natively with "show more" on unchanged regions

**Not included (deferred to post-v1):**
- No DB storage of diffs
- No approve/reject flow — agents manage their own commits
- No PR creation from diff view

**Dependencies:** Task 3.1

### ~~Task 6.2: Diff Viewer Component~~ → Merged into Task 6.1

### ~~Task 6.3: Approve/Reject Flow~~ → **Deferred to Post-v1**

> Agents handle commits/pushes via CLI. Approve/reject flow may be added later if needed.

---

**Implementation Notes:**

| Component | File | Description |
|---|---|---|
| Backend routes | `backend/src/routes/tasks.ts` | GET /sessions/:id/diff and SSE stream — session-scoped, task sessions resolve via task workspace |
| getDiff impl | `backend/src/lib/plugins/workspace-default.ts` | git-worktree provider |
| getDiff impl | `backend/src/server.ts` | cwd provider |
| DiffViewer component | `frontend/src/components/custom/diff-viewer.tsx` | Collapsible file list |
| PluginKit | `shared/types/plugin-kit.ts` | DiffViewer interface |
| Host exposure | `frontend/src/main.tsx` | Exposed as window.__AGEMON__.host |
| Tasks plugin | `plugins/tasks/renderers/page.tsx` | "View Changes" button |

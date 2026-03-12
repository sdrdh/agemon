## Phase 6: Diff Viewer (Week 6) → **Reworked: Lightweight Read-Only Diff View**

**Goal:** Show changed files for context — no DB storage, no approve/reject flow

> **Rationale:** Agents handle their own git operations. The old Phase 6 (diff generation → DB storage → approve/reject → commit/push) is redundant. Instead, provide a lightweight read-only view of `git diff` output so users can see what changed at a glance.

### Task 6.1: Lightweight Diff Viewer

**Priority:** P2
**Status:** Todo
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Backend endpoint: `GET /tasks/:id/diff` — runs `git diff` in the task's worktree(s) and returns raw unified diff
- [ ] Frontend: diff viewer component with syntax-highlighted unified diff (additions green, deletions red)
- [ ] Collapsible file sections, sticky file headers
- [ ] Mobile-optimized touch scrolling
- [ ] "View Changes" button on task detail page (only shown when task has worktree repos)

**Not included (deferred to post-v1):**
- No DB storage of diffs
- No approve/reject flow — agents manage their own commits
- No PR creation from diff view

**Dependencies:** Task 3.1

### ~~Task 6.2: Diff Viewer Component~~ → Merged into Task 6.1

### ~~Task 6.3: Approve/Reject Flow~~ → **Deferred to Post-v1**

> Agents handle commits/pushes via CLI. Approve/reject flow may be added later if needed.

---

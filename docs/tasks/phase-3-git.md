## Phase 3: Git Integration (Week 3-4)

**Goal:** Multi-repo worktree management and GitHub PR creation

### Task 3.1: Git Worktree Manager

**Priority:** P0  
**Estimated Time:** 12 hours

**Deliverables:**
- [x] Install `simple-git` dependency
- [x] Create `GitWorktreeManager` class
- [x] Implement worktree creation (bare repo cache + per-task worktrees)
- [x] Implement worktree deletion (per-task and per-repo cleanup)
- [x] Branch naming convention logic (`agemon/{taskId}-{org}-{repo}`)
- [x] Path resolution utilities (`getWorktreePath`, `getBranchName`)

**Core Functions:**
```typescript
class GitWorktreeManager {
  createWorktree(taskId: string, repoUrl: string, baseBranch: string): Promise<string>
  deleteWorktree(taskId: string, repoName: string): Promise<void>
  commitChanges(taskId: string, message: string): Promise<void>
  pushBranch(taskId: string, repoName: string): Promise<void>
  getWorktreePath(taskId: string, repoName: string): string
  getDiff(taskId: string): Promise<string>
}
```

**Acceptance Criteria:**
- Worktree created at `.agemon/tasks/{taskId}/{repoName}`
- Branch follows naming: `{taskId}-{repoName}`
- Multiple worktrees for same repo work independently
- Cleanup removes worktree and references
- Error handling for git failures
- Works with SSH and HTTPS git URLs

**Dependencies:** Task 1.2

---

### Task 3.2: GitHub Integration → **Deferred to Post-v1**

> **Rationale:** Agents (Claude Code, OpenCode, etc.) have full CLI access to `git` and `gh`. They can create PRs, push branches, and manage repos directly. Agemon-level GitHub integration is redundant for v1.

---

### Task 3.3: "One-Tap" Multi-Repo PR Flow → **Deferred to Post-v1**

> **Rationale:** Same as 3.2 — agents can be prompted to create coordinated PRs across repos using CLI tools.

---

### Task 3.4: ~~Generate Task-Level CLAUDE.md and Symlink Skills for Agent Context~~ → Moved to Phase 3.5

> **Note:** This task has been expanded into a full phase. See **Phase 3.5: Agent Context Harness** below.

---

### Task 3.5: Session Context Usage Tracking & Display

**Priority:** P1
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Capture `usage_update` notifications from ACP agents (currently ignored at `lib/acp.ts:375`)
- [ ] Normalize token fields (inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens)
- [ ] Store cumulative usage on the `agent_sessions` table (add columns or JSON field)
- [ ] Broadcast usage updates to frontend via WebSocket event (`session_usage_update`)
- [ ] Add shared types for session usage data
- [ ] Display context usage in session UI (token counts, context window % bar)

**Key Considerations:**
- ACP agents already emit `usage_update` — protocol support is mature across claude-agent-acp, openclaw, acpx
- Distinguish between accumulated usage (sum of all API calls) and last-call usage (true context window at end) — last-call is more useful for showing context % utilization
- Keep DB writes efficient — usage updates can be frequent; consider batching or only storing latest snapshot per session
- Frontend display should be lightweight — a small context bar or token count in the session header, not a full dashboard

**Affected Areas:** backend (`lib/acp.ts`, `db/schema.sql`, `db/client.ts`), shared types, frontend (session UI)

**Dependencies:** Task 4.1 (ACP Client Setup)

---

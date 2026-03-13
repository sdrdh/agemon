## Phase 3.5: Agent Context Harness

**Goal:** Make agents reliable and context-aware by providing task context, repo awareness, skills, and behavioral guidelines — regardless of agent type. Inspired by how emdash.sh injects environment variables and initial prompts, but going further with generated context files and first-prompt injection.

**Background:** Currently, agents receive only a cwd (first repo's worktree) and MCP servers. They have no awareness of the task they're working on, other repos in the workspace, branch conventions, or available skills. This phase makes every agent session start with full context.

### Task 3.5.1: Change Agent CWD to Task Folder

**Priority:** P0
**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Change agent spawn cwd from first repo worktree to the task folder (`.agemon/tasks/{task-id}/`)
- [ ] Update `spawnAndHandshake()` and `resumeSession()` in `lib/acp.ts` to use task folder as cwd
- [ ] Handle edge case: task folder doesn't exist yet (create it, or fall back to `process.cwd()`)
- [ ] Verify all agent types (claude-code, opencode, aider, gemini) work with task folder as cwd

**Key Considerations:**
- Task folder is the natural root when a task spans multiple repos — agent sees all worktrees as subdirectories
- For single-repo tasks, agent just needs to `cd` into the one subdirectory
- Generated CLAUDE.md (Task 3.5.2) will tell the agent about repo locations

**Affected Areas:** backend (`lib/acp.ts`)

**Dependencies:** Task 3.1 (Git Worktree Manager)

---

### Task 3.5.2: Generate Task-Level CLAUDE.md

**Priority:** P0
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Generate a `CLAUDE.md` at the task folder (`.agemon/tasks/{task-id}/CLAUDE.md`) when a session starts
- [ ] Include task context: title, description, status, attached repos
- [ ] Include worktree layout: list each repo with its subdirectory name and branch
- [ ] Include behavioral guidelines: commit to worktree branch, don't modify main, don't push without approval
- [ ] Reference each repo's own CLAUDE.md path so the agent knows to read them (Claude Code walks up, not down)
- [ ] Regenerate on session resume and when repos are attached/detached from a task
- [ ] Skip generation when no worktree exists (fallback cwd mode)
- [ ] Keep generated content concise — agents have context limits

**Key Considerations:**
- Template should be a simple function in a new `lib/context.ts` module
- Claude Code auto-loads `CLAUDE.md` from cwd and parent directories — our generated file at task root is automatically picked up
- For non-Claude agents (opencode, aider, gemini) this file exists but may not be auto-loaded — Task 3.5.4 handles those via first-prompt injection
- Repo attach/detach route (`routes/tasks.ts`) should trigger regeneration

**Affected Areas:** backend (new `lib/context.ts`, `lib/acp.ts`, `routes/tasks.ts`)

**Dependencies:** Task 3.5.1

---

### Task 3.5.3: Symlink Repo Skills into Task Folder

**Priority:** P1
**Estimated Time:** 3 hours

**Deliverables:**
- [ ] On session start, symlink each repo's `.claude/skills/*` into `.agemon/tasks/{task-id}/.claude/skills/`
- [ ] Use flat structure (no namespace prefixes) so Claude's skill matching works naturally
- [ ] Handle collisions: first-repo-wins, log warning on skip
- [ ] Re-symlink on session resume and when repos are attached/detached
- [ ] Clean up stale symlinks when repos are detached

**Key Considerations:**
- Skills are Claude Code specific — other agents don't use this convention
- Symlinks must be relative (not absolute) so they work if the `.agemon/` directory moves
- Only symlink if the source skill directory exists — don't error on repos without skills
- **Future extension:** When ProjectGroup configuration (Task 4.14) lands, also symlink ProjectGroup-level skills into the task folder. Design the symlink logic to accept multiple skill sources (repos + project group) with a clear merge order (repo skills override project group skills on collision)

**Affected Areas:** backend (`lib/context.ts`, `lib/acp.ts`)

**Dependencies:** Task 3.5.1

---

### Task 3.5.4: First-Prompt Context Injection

**Priority:** P0
**Estimated Time:** 3 hours

**Deliverables:**
- [ ] Prepend task context to the user's first message sent to any agent session
- [ ] Context block includes: task title, description, repo list with paths, branch conventions
- [ ] Format as a clear system-style preamble (e.g. wrapped in XML tags or markdown section) before the user's actual message
- [ ] Apply to all agent types universally (claude-code, opencode, aider, gemini)
- [ ] Only inject on the first `session/prompt` — subsequent messages pass through unmodified

**Key Considerations:**
- This is the universal context mechanism — works for every agent regardless of whether they read CLAUDE.md
- Claude Code gets context from both CLAUDE.md and first-prompt (redundant but harmless — CLAUDE.md has behavioral rules, first-prompt has task specifics)
- Non-Claude agents rely entirely on this for task awareness
- Keep injection concise to avoid eating into the agent's context window
- The `sendPrompt()` function in `lib/acp.ts` is the natural injection point

**Affected Areas:** backend (`lib/acp.ts`)

**Dependencies:** Task 3.5.2 (reuses the context template)

---

### Task 3.5.5: Copy Gitignored Files into Worktrees

**Priority:** P2
**Estimated Time:** 2 hours

**Deliverables:**
- [ ] On worktree creation, copy gitignored files matching configurable patterns from the bare repo's main checkout into the new worktree
- [ ] Default patterns: `.env`, `.env.local`, `.env.*.local`, `.envrc`
- [ ] Only copy files that don't already exist in the destination
- [ ] Run once at worktree creation time, not on every session start

**Key Considerations:**
- Inspired by emdash's "preserve patterns" feature — agents need `.env` files to run dev servers
- Bare repos don't have a working tree to copy from — need to identify the "source of truth" (main branch checkout or user-specified path)
- This may need to wait until the git worktree manager (Task 3.1) is implemented to determine the right source

**Affected Areas:** backend (`lib/git.ts`)

**Dependencies:** Task 3.1 (Git Worktree Manager)

---

### Task 3.5.6: Task Environment Variables

**Priority:** P2
**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Inject task-specific environment variables into agent process on spawn
- [ ] Include: `AGEMON_TASK_ID`, `AGEMON_TASK_NAME`, `AGEMON_TASK_PATH`, `AGEMON_SESSION_ID`
- [ ] Include per-repo vars: paths to each worktree directory
- [ ] Pass through existing agent env vars (auth tokens etc.) alongside new ones

**Key Considerations:**
- Similar to emdash's `EMDASH_TASK_ID` etc. — useful for setup scripts and agent tooling
- `buildAgentEnv()` in `lib/agents.ts` already constructs the env — extend it with task context
- Keep the variable namespace clean and documented

**Affected Areas:** backend (`lib/agents.ts`, `lib/acp.ts`)

**Dependencies:** Task 3.5.1

---

# Plugin System v2 — Workspace Provider

## The Core Insight

The current v2 design treats `WorkspaceProvider` as effectively mandatory (bundled default is git-workspace). This is wrong.

The base case for most developers — and the one pi-mono, Shelley, and most agent tools use — is **run the agent in a directory I point at**. No worktree isolation, no branch management. Just: here's a CWD, run here.

Git worktrees add value (isolation, parallel sessions, clean diffs) but they're an *enrichment*, not a prerequisite.

---

## New Model

### Session needs exactly one thing from the workspace layer:

```ts
cwd: string   // where the agent runs
```

That's it. Everything else (worktree create/cleanup, branch management, context sections, diff generation) is optional enrichment.

### WorkspaceProvider is optional at the core level

Core resolves session CWD in order:

```
1. WorkspaceProvider.prepare(session) → returns { cwd }   (if a provider is configured)
2. session.meta_json.cwd → use as-is                       (explicit path, no provider)
3. Error / prompt user
```

If no `WorkspaceProvider` is wired, the session starts in whatever `cwd` was specified. The agent runs there. That's the full story.

---

## WorkspaceProvider Interface

```ts
interface WorkspaceProvider {
  // Prepare workspace before agent spawns. Returns the CWD the agent should run in.
  // Called with a cancellation signal — long operations (git clone, npm install) must respect it.
  prepare(session: SessionMeta, signal: AbortSignal): Promise<WorkspaceResult>;

  // Clean up after session ends (delete worktree, release locks, etc.)
  // Optional — local-dir provider would be a no-op.
  cleanup?(session: SessionMeta): Promise<void>;

  // Generate a diff of changes made during the session.
  // Optional — only meaningful for VCS-backed workspaces.
  getDiff?(session: SessionMeta): Promise<string | null>;

  // Extra sections to inject into the agent's CLAUDE.md context.
  // e.g. "use jj commands, not git:" for the jj-workspace plugin.
  contextSections?(session: SessionMeta): Promise<string[]>;

  // Extra sections to inject into the agent's guidelines/constraints.
  guidelinesSections?(session: SessionMeta): Promise<string[]>;
}

interface WorkspaceResult {
  cwd: string;
  // Optional metadata the plugin wants stored back on the session
  meta?: Record<string, unknown>;
}

interface SessionMeta {
  sessionId: string;
  agentType: string;
  meta: Record<string, unknown>;   // session.meta_json parsed
}
```

All methods except `prepare` are optional. A local-dir provider could be as simple as:

```ts
const LocalDirProvider: WorkspaceProvider = {
  async prepare(session) {
    const cwd = session.meta.cwd as string;
    if (!cwd) throw new Error("session.meta.cwd is required for local-dir workspace");
    return { cwd };
  }
};
```

---

## Progress Callbacks

`prepare()` can take minutes (git clone on slow connection, npm install). The interface needs a way to stream progress to the UI.

Option: progress is emitted via the event bridge rather than returned from prepare.

```ts
// WorkspaceProvider calls ctx.broadcast() during prepare:
ctx.broadcast({ type: "workspace_progress", sessionId, message: "Cloning repo..." });
ctx.broadcast({ type: "workspace_progress", sessionId, message: "Installing deps... (42%)" });
```

Session chat UI shows a progress timeline while workspace is being prepared. No special interface needed — just broadcast events.

---

## Workspace Selection Happens at Task Creation, Not Session Creation

A task's workspace is chosen once at creation and applies to all sessions spawned from that task. Sessions themselves don't pick a workspace — they inherit it from the task.

This is stored in the tasks plugin DB:

```sql
-- In tasks.db (tasks plugin)
CREATE TABLE task_workspaces (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(id),
  provider_id TEXT NOT NULL,    -- "cwd" | "git-worktree" | "jj-workspace" | ...
  config_json TEXT NOT NULL DEFAULT '{}'
);
```

`config_json` is provider-specific:
- `cwd` → `{ "path": "/home/user/.agemon/plugins/my-plugin" }`
- `git-worktree` → `{ "repos": ["sdrdh/agemon", "sdrdh/pi-mono"] }`
- `jj-workspace` → `{ "repos": ["sdrdh/agemon"] }`

`task_repos` is replaced by `task_workspaces.config_json.repos` for git-worktree tasks.

When spawning a session for a task, the tasks plugin reads the workspace config and writes it into `meta_json`:
```json
{ "task_id": "abc", "workspaceProvider": "git-worktree", "repos": ["sdrdh/agemon"] }
```

Core spawn calls `workspaceRegistry.get(session.meta.workspaceProvider).prepare(session)`.

---

## Task Creation UI — Workspace Picker

Step 2 of task creation (after title/description):

```
○ Local directory   [/path/to/project]        ← default, always available
○ Git worktree      [repo URL] [branch]        ← git-workspace plugin
○ jj workspace      [repo URL]                 ← jj-workspace plugin
○ Remote (SSH)      [user@host:/path]          ← remote-workspace plugin (future)
○ Docker            [image] [mount]            ← docker-workspace plugin (future)
```

If `git-workspace` plugin isn't loaded, that option is hidden. Each WorkspaceProvider can declare its form fields via `PluginExports.workspaceFormFields` and the UI renders them dynamically.

**Use cases for local directory (cwd):**
- Create a new Agemon plugin (`~/.agemon/plugins/my-plugin/`) — agent scaffolds it in place
- Work on Agemon's own frontend (`~/.agemon/tasks/{id}/sdrdh--agemon/frontend/`)
- Experiment with CSS, one-off scripts, scratch work
- Any existing project on disk without needing a git remote

---

## git-workspace Plugin

The current `lib/git.ts` + `lib/context.ts` git parts move here.

```
plugins/git-workspace/
├── agemon-plugin.json
└── index.ts        WorkspaceProvider implementation
```

**prepare():**
1. Fetch/update bare repo cache at `~/.agemon/repos/{org}--{repo}.git`
2. Create worktree at `~/.agemon/tasks/{taskId}/{org}--{repo}/`
3. Create branch `agemon/{taskId}-{org}--{repo}`
4. Return `{ cwd: ~/.agemon/tasks/{taskId}/ }`

**cleanup():**
1. `git worktree remove`
2. Delete branch (optional — may want to keep for PR creation)

**getDiff():**
1. `git diff main...HEAD` in the worktree

**contextSections():**
- Injects repo-specific CLAUDE.md content

**Open questions:**
- Remote fetch: currently `git fetch origin --prune` runs on every session start. This is slow. Should it be async/background? Should the jj-workspace plugin be the preferred path for remote repos?
- Multi-repo sessions: current model creates one worktree per repo per task. Does this belong in the git-workspace plugin or in the tasks plugin? Probably tasks plugin — it knows about task→repo associations, git-workspace just knows how to create a worktree given a repo URL.

---

## jj-workspace Plugin

Uses Jujutsu instead of git worktrees. Solves the remote fetch friction.

```
plugins/jj-workspace/
├── agemon-plugin.json
└── index.ts
```

**prepare():**
1. `jj workspace add ~/.agemon/sessions/{id}/{repo}` instead of `git worktree add`
2. Return `{ cwd }`

**cleanup():**
1. `jj workspace forget` + rm

**getDiff():**
1. `jj diff` — no staging area, tracks working copy automatically

**contextSections():**
```
Use jj commands, not git:
  jj new          (instead of git checkout -b)
  jj describe     (instead of git commit -m)
  jj diff / jj status
  jj git push     (to push to remote)
No staging area — jj tracks working copy changes automatically.
```

**Requirement:** Checks for `jj` binary at plugin load, fails gracefully if absent. Works in colocated mode (`jj git init --colocate`) — repo stays valid git for `gh pr create`.

---

## Hook Ordering for Workspace

Multiple plugins could theoretically register `session:before_spawn` hooks (e.g. both workspace and tasks plugin). The workspace hook must complete before the tasks plugin writes CLAUDE.md (which needs the resolved `cwd`).

Solution: hooks have an optional `priority` number. Lower = runs first. WorkspaceProvider hook runs at priority 0, tasks plugin at priority 10.

```ts
ctx.hook('session:before_spawn', handler, { priority: 0 });  // workspace
ctx.hook('session:before_spawn', handler, { priority: 10 }); // tasks
```

---

## What This Means for the Core ACP Spawn Path

Current `acp/spawn.ts` directly calls `GitWorktreeManager`. After extraction:

```ts
async function spawnSession(session: Session): Promise<Process> {
  // 1. Resolve CWD
  let cwd = session.meta?.cwd as string | undefined;
  if (workspaceProvider) {
    const result = await workspaceProvider.prepare(session, abortController.signal);
    cwd = result.cwd;
  }
  if (!cwd) throw new Error("No cwd: provide a WorkspaceProvider or set meta.cwd");

  // 2. Get agent command
  const provider = agentRegistry.get(session.agentType);
  const { command, args, env } = provider.buildCommand(session, cwd);

  // 3. Spawn
  return Bun.spawn([command, ...args], { cwd, env });
}
```

Clean. No git imports. No task imports. Takes interfaces.

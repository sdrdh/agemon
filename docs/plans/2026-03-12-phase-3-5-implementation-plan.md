# Phase 3.5: Agent Context Harness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make agents reliable and context-aware by providing task context, repo awareness, skills, and behavioral guidelines — regardless of agent type.

**Status summary:**
- Task 3.5.1 (CWD → task folder): **Already done** — document only.
- Task 3.5.2 (Generate CLAUDE.md): **Partially done** — missing worktree layout, behavioral guidelines, and AGENTS.md generation.
- Task 3.5.3 (Symlink repo skills): **Already done** — document only.
- Task 3.5.4 (First-prompt injection): **Partially needed** — only for agents that don't auto-load context files.

---

## Context delivery strategy

Three complementary mechanisms ensure every agent type gets task context:

| Mechanism | Who benefits | Where |
|-----------|-------------|--------|
| `CLAUDE.md` with `@filepath` references | claude-code | `lib/context.ts` |
| `AGENTS.md` with inlined content | codex (and future agents) | `lib/context.ts` |
| First-prompt injection | opencode, gemini, pi | `lib/acp.ts` |

`CLAUDE.md` and `AGENTS.md` cover the two auto-loading agents completely. First-prompt injection is gated to agents that don't auto-load either file — avoiding wasting context window tokens on redundant delivery.

---

## Task A: Verify Task 3.5.1 — Agent CWD Is Task Folder

**Status: Done. Verify and mark complete.**

### What's already implemented

`spawnAndHandshake()` (`lib/acp.ts:727`):
```typescript
const agentCwd = getTaskDir(taskId);           // ~/.agemon/tasks/{taskId}/
prepareTaskDir(task).then(() =>
  runAcpHandshake(rs.transport, sessionId, taskId, agentCwd)
);
```

`resumeSession()` (`lib/acp.ts:890`):
```typescript
const agentCwd = getTaskDir(taskId);
await prepareTaskDir(task);
// agentCwd passed to session/load and session/new
```

`runAcpHandshake()` (`lib/acp.ts:128`):
```typescript
await transport.request('session/new', { cwd, mcpServers });
```

The OS process CWD is intentionally not set — ACP protocol carries `cwd` via `session/new`. Agents receive the task folder as their working directory. Edge case handled: `prepareTaskDir()` calls `mkdir(taskDir, { recursive: true })` before the handshake.

### Acceptance verification

- Agent sessions receive task folder path in `session/new` cwd.
- Repos visible as subdirectories (e.g. `~/.agemon/tasks/{taskId}/org--repo/`).

### Mark done

Check off deliverables in `docs/tasks/phase-3-5-agent-context.md` for Task 3.5.1.

---

## Task B: Complete Task 3.5.2 — Enhance CLAUDE.md + Add AGENTS.md

**Status: Partial. `context.ts` exists but is missing worktree layout, behavioral guidelines, and AGENTS.md.**

### Files to modify

- `backend/src/lib/context.ts` — update `generateClaudeMd()`, add `generateAgentsMd()`, wire into `refreshTaskContext()`

### What's already in `generateClaudeMd()`

1. `# Task: {title}`
2. Description (sanitized)
3. `@~/.agemon/CLAUDE.md` (global instructions reference)
4. Per-repo `@{repoDir}/CLAUDE.md` and `@{repoDir}/AGENT.md` references

### Changes to `generateClaudeMd()`

Add **Workspace Layout** and **Agent Guidelines** sections after the description, before the `---` divider:

```typescript
async function generateClaudeMd(task: Task, taskDir: string): Promise<void> {
  const safeTitle = task.title.replace(/\n/g, ' ').replace(/^#+\s*/g, '').slice(0, 500);
  const lines: string[] = [`# Task: ${safeTitle}`, ''];

  if (task.description) {
    const safeDesc = task.description
      .replace(/^(#+)/gm, '\\$1')
      .replace(/@/g, '\\@');
    lines.push(safeDesc, '');
  }

  // NEW: Worktree layout
  if (task.repos.length > 0) {
    lines.push('## Workspace Layout', '');
    lines.push('Repos checked out as subdirectories of your working directory:', '');
    for (const repo of task.repos) {
      const repoSafe = safeName(repo.name);
      const branch = `agemon/${task.id}-${repoSafe}`;
      lines.push(`- \`${repoSafe}/\` — ${repo.name} (branch: \`${branch}\`)`);
    }
    lines.push('');
  }

  // NEW: Behavioral guidelines
  lines.push('## Agent Guidelines', '');
  lines.push('- **Your working directory** is this task folder. Each repo is a subdirectory.');
  lines.push('- **Commit on the worktree branch** — never commit directly to `main` or `master`.');
  lines.push('- **Do not push** without explicit user approval via the Agemon diff review flow.');
  lines.push('- **Do not create PRs** autonomously. The user will initiate PR creation.');
  lines.push('');

  lines.push('---', '', '## Global Instructions', '');

  const globalClaudeMd = join(AGEMON_DIR, 'CLAUDE.md');
  if (await exists(globalClaudeMd)) {
    lines.push(`@${globalClaudeMd}`, '');
  }

  if (task.repos.length > 0) {
    lines.push('## Repo Instructions', '');
    for (const repo of task.repos) {
      const repoDir = join(taskDir, safeName(repo.name));
      for (const filename of ['CLAUDE.md', 'AGENT.md']) {
        const candidate = join(repoDir, filename);
        if (await exists(candidate)) lines.push(`@${candidate}`);
      }
    }
    lines.push('');
  }

  await writeFile(join(taskDir, 'CLAUDE.md'), lines.join('\n'));
}
```

### New `generateAgentsMd()` function

`AGENTS.md` carries the same task-specific content as `CLAUDE.md` but with **no `@filepath` directives** — those are Claude Code-specific and would appear as literal text to other agents. Instead, per-repo instruction files are noted by name so the agent can read them directly.

Add after `generateClaudeMd()`:

```typescript
async function generateAgentsMd(task: Task, taskDir: string): Promise<void> {
  const safeTitle = task.title.replace(/\n/g, ' ').replace(/^#+\s*/g, '').slice(0, 500);
  const lines: string[] = [`# Task: ${safeTitle}`, ''];

  if (task.description) {
    const safeDesc = task.description
      .replace(/^(#+)/gm, '\\$1')
      .replace(/@/g, '\\@');
    lines.push(safeDesc, '');
  }

  if (task.repos.length > 0) {
    lines.push('## Workspace Layout', '');
    lines.push('Repos checked out as subdirectories of your working directory:', '');
    for (const repo of task.repos) {
      const repoSafe = safeName(repo.name);
      const branch = `agemon/${task.id}-${repoSafe}`;
      lines.push(`- \`${repoSafe}/\` — ${repo.name} (branch: \`${branch}\`)`);
      // Note any repo-level instruction files (no @filepath — agents read them directly)
      for (const filename of ['AGENTS.md', 'CLAUDE.md']) {
        const candidate = join(taskDir, repoSafe, filename);
        if (await exists(candidate)) {
          lines.push(`  - See \`${repoSafe}/${filename}\` for repo-specific instructions`);
        }
      }
    }
    lines.push('');
  }

  lines.push('## Agent Guidelines', '');
  lines.push('- **Your working directory** is this task folder. Each repo is a subdirectory.');
  lines.push('- **Commit on the worktree branch** — never commit directly to `main` or `master`.');
  lines.push('- **Do not push** without explicit user approval.');
  lines.push('- **Do not create PRs** autonomously. The user will initiate PR creation.');
  lines.push('');

  await writeFile(join(taskDir, 'AGENTS.md'), lines.join('\n'));
}
```

### Wire both into `refreshTaskContext()`

```typescript
export async function refreshTaskContext(task: Task): Promise<void> {
  const taskDir = join(AGEMON_DIR, 'tasks', task.id);
  await mkdir(taskDir, { recursive: true });

  await Promise.all([
    generateClaudeMd(task, taskDir),
    generateAgentsMd(task, taskDir),   // NEW
    refreshPluginSymlinks(task, taskDir),
    refreshSkillSymlinks(task, taskDir),
    wireAgentPluginDirs(taskDir),
    wireAgentSkillDirs(taskDir),
  ]);
}
```

### Key decisions

**No symlink between the two files** — content differs. `CLAUDE.md` uses `@filepath` references that Claude Code follows at read time; `AGENTS.md` omits them to stay readable by any agent.

**Branch name computed locally** — `agemon/${task.id}-${safeName(repo.name)}` is trivial to derive without importing `gitManager`. If `git.ts` branch convention changes, update both files.

**Repo instruction hints in AGENTS.md** — rather than `@filepath`, note the file path as plain text so agents that support AGENTS.md can read per-repo instructions themselves.

### Edge cases

- **No repos attached**: Workspace Layout omitted from both files. Guidelines always present.
- **Repo not yet checked out**: Branch name still listed — tells agent what to expect.
- **Description contains `@` or `#`**: Existing sanitization handles both.
- **Global `~/.agemon/CLAUDE.md` missing**: `CLAUDE.md` omits the `@` reference gracefully. `AGENTS.md` is unaffected.

### Acceptance criteria

- `~/.agemon/tasks/{taskId}/CLAUDE.md` contains Workspace Layout + Agent Guidelines + `@filepath` references.
- `~/.agemon/tasks/{taskId}/AGENTS.md` contains Workspace Layout + Agent Guidelines, zero `@filepath` lines.
- Both files regenerated on repo attach/detach (via `refreshTaskContext()` in `routes/tasks.ts`).
- Both files regenerated on session start (via `prepareTaskDir()` in `acp.ts`).

---

## Task C: Verify Task 3.5.3 — Skill Symlinks

**Status: Done. Verify and mark complete.**

### What's already implemented

`refreshTaskContext()` (`lib/context.ts:35`) coordinates:
- `refreshSkillSymlinks()` — symlinks each repo's `.claude/skills/` into `.agemonskills/{repoSafe}/`
- `wireAgentSkillDirs()` — flattens individual skill dirs from `.agemonskills/` and `~/.agemon/skills/` into each agent's discovery path (`.claude/skills/`, `.agents/skills/`)
- `refreshPluginSymlinks()` and `wireAgentPluginDirs()` — same pattern for plugins

Safety: `isRealDirectory()` verifies paths resolve within the task directory — guards against malicious repo symlinks.

Collision handling: `flattenSkillsInto()` uses `try { await symlink(...) } catch { /* skip */ }` — first writer wins.

Stale cleanup: `pruneStaleSymlinks()` (detached repos) + `pruneDeadSymlinks()` (dead targets).

### Acceptance verification

After attaching a repo with `.claude/skills/my-skill/SKILL.md`:
- `~/.agemon/tasks/{taskId}/.agemonskills/{org}--{repo}/my-skill/` → symlink exists
- `~/.agemon/tasks/{taskId}/.claude/skills/_repo:{org}--{repo}:my-skill/` → symlink exists
- `~/.agemon/tasks/{taskId}/.agents/skills/_repo:{org}--{repo}:my-skill/` → symlink exists

After detaching: all stale symlinks removed.

### Mark done

Check off deliverables in `docs/tasks/phase-3-5-agent-context.md` for Task 3.5.3.

---

## Task D: Implement Task 3.5.4 — Gated First-Prompt Context Injection

**Status: Not implemented.**

First-prompt injection is only needed for agents that don't auto-load `CLAUDE.md` or `AGENTS.md`. Injecting for claude-code and codex wastes context window tokens on content they already have.

### Agent capability matrix

| Agent | Auto-loads context file | Needs injection |
|-------|:-:|:-:|
| claude-code | ✅ CLAUDE.md | ❌ skip |
| codex | ✅ AGENTS.md | ❌ skip |
| opencode | ❌ | ✅ inject |
| gemini | reads GEMINI.md only | ✅ inject |
| pi | ❌ | ✅ inject |

### Files to modify

1. `backend/src/lib/agents.ts` — add `autoLoadsContextFile` flag to `AgentConfig`
2. `backend/src/lib/context.ts` — add `buildFirstPromptContext()` export
3. `backend/src/lib/acp.ts` — modify `sendPromptTurn()` to inject conditionally

### Step 1: Add flag to `AgentConfig` in `agents.ts`

```typescript
export interface AgentConfig {
  command: string[];
  passEnvVars: string[];
  label: string;
  parseConfigOptions: ConfigOptionParser;
  pluginPaths: AgentPluginPath[];
  skillPaths: AgentSkillPath[];
  /**
   * True if this agent auto-loads a context file (CLAUDE.md or AGENTS.md)
   * from the cwd. When true, first-prompt context injection is skipped to
   * avoid wasting context window tokens on duplicate information.
   */
  autoLoadsContextFile: boolean;
}
```

Set in `AGENT_CONFIGS`:

```typescript
'claude-code': { ...existing..., autoLoadsContextFile: true  },
'codex':       { ...existing..., autoLoadsContextFile: true  },
'opencode':    { ...existing..., autoLoadsContextFile: false },
'gemini':      { ...existing..., autoLoadsContextFile: false },
'pi':          { ...existing..., autoLoadsContextFile: false },
```

### Step 2: Add `buildFirstPromptContext()` to `context.ts`

Add after `getTaskDir()`:

```typescript
/**
 * Build a compact context preamble for first-prompt injection.
 * Only used for agents that don't auto-load CLAUDE.md or AGENTS.md (see
 * autoLoadsContextFile in agents.ts). Keep concise — every token here
 * reduces the agent's effective context window.
 */
export function buildFirstPromptContext(task: Task): string {
  const lines: string[] = [
    '<agemon_task_context>',
    `Task: ${task.title.replace(/\n/g, ' ').slice(0, 200)}`,
  ];

  if (task.description) {
    const firstLine = task.description.split('\n').find(l => l.trim()) ?? '';
    const summary = firstLine.trim().slice(0, 300);
    if (summary) lines.push(`Description: ${summary}`);
  }

  if (task.repos.length > 0) {
    lines.push('');
    lines.push('Repos (relative paths from your cwd):');
    for (const repo of task.repos) {
      const repoSafe = safeName(repo.name);
      const branch = `agemon/${task.id}-${repoSafe}`;
      lines.push(`  ${repoSafe}/  [${repo.name}] branch: ${branch}`);
    }
  }

  lines.push('');
  lines.push('Rules: commit on your worktree branch only; do not push or create PRs autonomously.');
  lines.push('</agemon_task_context>');
  lines.push('');

  return lines.join('\n');
}
```

### Step 3: Gate injection in `sendPromptTurn()` in `acp.ts`

The first-prompt indicator already exists: `sessionRecord.name` is null until the first prompt names the session.

```typescript
export async function sendPromptTurn(sessionId: string, content: string): Promise<void> {
  // ... existing early-exit checks ...

  const sessionRecord = db.getSession(sessionId);
  // ... existing null check ...

  const isFirstPrompt = !sessionRecord.name;

  // Inject context on first prompt only, and only for agents that don't
  // auto-load CLAUDE.md or AGENTS.md from cwd.
  let finalContent = content;
  if (isFirstPrompt) {
    const agentConfig = AGENT_CONFIGS[entry.agentType];
    if (!agentConfig.autoLoadsContextFile) {
      const task = db.getTask(sessionRecord.task_id);
      if (task) {
        finalContent = buildFirstPromptContext(task) + content;
      }
    }
  }

  // Store ORIGINAL content — chat history shows what the user typed, not the preamble
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'prompt',
    content,  // not finalContent
  });

  // ... existing acpSessionId null check ...

  // Set session name from first prompt (existing logic — use original content)
  if (isFirstPrompt) {
    const name = content.length > 50 ? content.slice(0, 47) + '...' : content;
    db.updateSessionName(sessionId, name);
  }

  await entry.transport.request('session/prompt', {
    sessionId: entry.acpSessionId,
    prompt: [{ type: 'text', text: finalContent }],
  });
  // ... rest unchanged ...
}
```

### Step 4: Update imports in `acp.ts`

```typescript
// existing:
import { refreshTaskContext, getTaskDir } from './context.ts';
// updated:
import { refreshTaskContext, getTaskDir, buildFirstPromptContext } from './context.ts';

// AGENT_CONFIGS is already imported from agents.ts — no change needed
```

### Edge cases

| Case | Handling |
|------|----------|
| Task has no repos | Injection omits repo list; rules line still included |
| Task not found | `db.getTask()` returns null; skip injection, send raw content |
| Session resumed | Name already set from original session; `isFirstPrompt` is false → no re-injection ✓ |
| claude-code / codex | `autoLoadsContextFile: true` → injection skipped entirely |
| New agent added without setting flag | TypeScript compile error — `autoLoadsContextFile` is required on `AgentConfig` |

### Acceptance criteria

1. **claude-code and codex**: `session/prompt` payload is the user's raw message — no preamble.
2. **opencode, gemini, pi**: First `session/prompt` includes `<agemon_task_context>` block followed by user's message.
3. Second and subsequent prompts pass through unmodified for all agent types.
4. Chat history in DB stores only the original user text regardless of agent type.
5. Session name derived from original user text, not preamble.
6. Resumed sessions: no re-injection (name already set).

---

## Execution Order

```
Task B  ← modify context.ts: generateClaudeMd, generateAgentsMd, buildFirstPromptContext, refreshTaskContext
Task D1 ← add autoLoadsContextFile to AgentConfig + AGENT_CONFIGS in agents.ts
Task D2 ← gate injection in sendPromptTurn() in acp.ts (imports + logic)
Task A  ← mark checkboxes done in phase-3-5-agent-context.md
Task C  ← mark checkboxes done in phase-3-5-agent-context.md
```

Tasks B and D1 are independent — do in parallel or sequentially, both touch different files. D2 depends on both.

---

## Testing

```bash
# Terminal 1: start backend
cd backend && AGEMON_KEY=test bun run src/server.ts

# Check generated context files after creating a task with a repo:
cat ~/.agemon/tasks/{taskId}/CLAUDE.md
# Expect: Workspace Layout + Agent Guidelines + @filepath references

cat ~/.agemon/tasks/{taskId}/AGENTS.md
# Expect: Workspace Layout + Agent Guidelines, NO @filepath lines

# Start an opencode/gemini/pi session, send first message:
# → ACP log should show <agemon_task_context> prepended to the prompt

# Start a claude-code or codex session, send first message:
# → ACP log should show raw user message only, no preamble

# Confirm chat history stores original text (no preamble):
curl -H "Authorization: Bearer test" http://localhost:3000/sessions/{sessionId}/chat
```

Run smoke tests after any backend changes:
```bash
./scripts/test-api.sh
```

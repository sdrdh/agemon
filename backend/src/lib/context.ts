/**
 * Task context manager.
 *
 * Generates per-task context artifacts:
 *   - ~/.agemon/tasks/{taskId}/CLAUDE.md          (synthesized from global + repo instructions)
 *   - ~/.agemon/tasks/{taskId}/.agemonplugins/    (symlinks to repo .claude/plugins/)
 *   - ~/.agemon/tasks/{taskId}/.agemonskills/     (symlinks to repo .claude/skills/)
 *   - ~/.agemon/tasks/{taskId}/{agent-plugin-dir}/ (wired to global + task plugins, per agent config)
 *   - ~/.agemon/tasks/{taskId}/{agent-skill-dir}/  (wired to task skills, per agent config)
 *
 * Called at session start and when repos are attached/changed on a task.
 */

import { mkdir, writeFile, readFile, symlink, rm, access, readdir, lstat, stat, readlink } from 'fs/promises';
import type { Dirent } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getAllPluginPaths, getAllSkillPaths } from './agents.ts';
import type { Task } from '@agemon/shared';

/** Filesystem-safe repo dir name (mirrors git.ts safeName). */
function safeName(repoName: string): string {
  return repoName.replace(/\//g, '--');
}

/** Returns true if path exists. */
async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Reads AGEMON_DIR dynamically from env (testable without module mocking). */
function agemonDir(): string {
  return process.env.AGEMON_DIR ? resolve(process.env.AGEMON_DIR) : join(homedir(), '.agemon');
}

/**
 * Generate or refresh all context artifacts for a task.
 * Safe to call multiple times — idempotent. Stale symlinks are pruned.
 */
export async function refreshTaskContext(task: Task): Promise<void> {
  const taskDir = join(agemonDir(), 'tasks', task.id);
  await mkdir(taskDir, { recursive: true });

  await Promise.all([
    generateClaudeMd(task, taskDir),
    generateAgentsMd(task, taskDir),
    refreshPluginSymlinks(task, taskDir),
    refreshSkillSymlinks(task, taskDir),
    wireAgentPluginDirs(taskDir),
    wireAgentSkillDirs(taskDir),
  ]);
}

/** Get the task directory path (no I/O). */
export function getTaskDir(taskId: string): string {
  return join(agemonDir(), 'tasks', taskId);
}

// ─── CLAUDE.md / AGENTS.md ───────────────────────────────────────────────────

/** Derive the worktree branch name for a repo on a task (mirrors git.ts convention). */
function worktreeBranch(taskId: string, repoName: string): string {
  return `agemon/${taskId}-${safeName(repoName)}`;
}

/** Build task header lines (title + description). Sanitized against injection. */
function buildTaskHeader(task: Task): string[] {
  const safeTitle = task.title.replace(/\n/g, ' ').replace(/^#+\s*/g, '').slice(0, 500);
  const lines: string[] = [`# Task: ${safeTitle}`, ''];

  if (task.description) {
    const safeDesc = task.description
      .replace(/^(#+)/gm, '\\$1')   // escape # headings
      .replace(/@/g, '\\@');         // escape @ file references
    lines.push(safeDesc, '');
  }
  return lines;
}

/** Explain the Agemon environment and git worktree mechanics. */
function buildEnvironmentContext(): string[] {
  return [
    '## Environment',
    '',
    'You are running as an AI agent inside **Agemon** — a self-hosted, headless agent',
    'orchestration platform. The user queues tasks, monitors your output in real time,',
    'and may send follow-up messages or respond to blockers via the Agemon mobile UI.',
    '',
    '**Git worktrees:** Each repo subdirectory is a git worktree — a lightweight linked',
    'checkout sharing a bare repo cache. All standard git commands (`git add`, `git commit`,',
    '`git status`, `git log`, `git diff`) work normally.',
    '',
    '- Do **not** run `git clone` — repos are already checked out as worktrees',
    '- Do **not** run `git checkout` to switch branches — your worktree branch is',
    '  pre-configured and isolated; switching would break the worktree setup',
    '- The `.git` entry in each repo subdir is a file (not a directory) — this is normal',
    '  for git worktrees and does not indicate a problem',
    '',
  ];
}

/** Build the workspace layout section (repo subdirs + branch names). */
function buildWorkspaceLayout(task: Task): string[] {
  if (task.repos.length === 0) return [];
  const lines: string[] = ['## Workspace Layout', ''];
  lines.push(`Working directory: \`~/.agemon/tasks/${task.id}/\``, '');
  lines.push('Each repo is a git worktree subdirectory on its own isolated branch:', '');
  lines.push('| Directory | Branch |');
  lines.push('|-----------|--------|');
  for (const repo of task.repos) {
    const dir = safeName(repo.name);
    const branch = worktreeBranch(task.id, repo.name);
    lines.push(`| \`${dir}/\` | \`${branch}\` |`);
  }
  lines.push('');
  return lines;
}

/** Build the agent guidelines section. */
function buildAgentGuidelines(): string[] {
  return [
    '## Agent Guidelines',
    '',
    '- **Commit to your worktree branch** — never commit to `main` or `master`',
    '- **Do not push** without explicit user approval',
    '- **Do not open PRs** without explicit user approval',
    '- Work within the repo subdirectory relevant to your task',
    '- **Task Memory:** Maintain `memory/MEMORY.md` in this task directory. As you work,',
    '  append important discoveries, decisions made, dead ends hit, and context',
    '  future sessions will need. Read it at session start if it exists.',
    '',
  ];
}

async function generateClaudeMd(task: Task, taskDir: string): Promise<void> {
  const lines: string[] = [
    ...buildTaskHeader(task),
    '---', '',
    ...buildEnvironmentContext(),
    ...buildWorkspaceLayout(task),
    ...buildAgentGuidelines(),
    '## Global Instructions', '',
  ];

  const globalClaudeMd = join(agemonDir(), 'CLAUDE.md');
  if (await exists(globalClaudeMd)) {
    lines.push(`@${globalClaudeMd}`, '');
  }

  if (task.repos.length > 0) {
    lines.push('## Repo Instructions', '');
    for (const repo of task.repos) {
      const repoDir = join(taskDir, safeName(repo.name));
      for (const filename of ['CLAUDE.md', 'AGENT.md']) {
        const candidate = join(repoDir, filename);
        if (await exists(candidate)) {
          lines.push(`@${candidate}`);
        }
      }
    }
    lines.push('');
  }

  await writeFile(join(taskDir, 'CLAUDE.md'), lines.join('\n'));
}

/**
 * Generate AGENTS.md — same structure as CLAUDE.md but with no `@filepath`
 * directives. Used by agents (e.g. codex) that don't support the `@` syntax.
 * Referenced file paths are listed as plain text so the agent can read them.
 */
async function generateAgentsMd(task: Task, taskDir: string): Promise<void> {
  const lines: string[] = [
    ...buildTaskHeader(task),
    '---', '',
    ...buildEnvironmentContext(),
    ...buildWorkspaceLayout(task),
    ...buildAgentGuidelines(),
    '## Global Instructions', '',
  ];

  const globalClaudeMd = join(agemonDir(), 'CLAUDE.md');
  if (await exists(globalClaudeMd)) {
    lines.push(`See: ${globalClaudeMd}`, '');
  }

  if (task.repos.length > 0) {
    lines.push('## Repo Instructions', '');
    for (const repo of task.repos) {
      const repoDir = join(taskDir, safeName(repo.name));
      for (const filename of ['CLAUDE.md', 'AGENT.md']) {
        const candidate = join(repoDir, filename);
        if (await exists(candidate)) {
          lines.push(`See: ${candidate}`);
          break; // only include first found per repo
        }
      }
    }
    lines.push('');
  }

  await writeFile(join(taskDir, 'AGENTS.md'), lines.join('\n'));
}

/**
 * Build a first-prompt context block for agents that don't auto-load CLAUDE.md.
 * Inlines the task header, workspace layout, and guidelines without @filepath refs.
 * Wrapped in XML tags to separate it from the user's actual message.
 */
export async function buildFirstPromptContext(task: Task): Promise<string> {
  const taskDir = join(agemonDir(), 'tasks', task.id);
  const sections: string[] = [
    ...buildTaskHeader(task),
    ...buildWorkspaceLayout(task),
    ...buildAgentGuidelines(),
  ];

  const globalClaudeMd = join(agemonDir(), 'CLAUDE.md');
  if (await exists(globalClaudeMd)) {
    try {
      const content = await readFile(globalClaudeMd, 'utf8');
      sections.push('## Global Instructions', '', content.trim(), '');
    } catch { /* skip if unreadable */ }
  }

  if (task.repos.length > 0) {
    sections.push('## Repo Instructions', '');
    for (const repo of task.repos) {
      const repoDir = join(taskDir, safeName(repo.name));
      for (const filename of ['CLAUDE.md', 'AGENT.md']) {
        const candidate = join(repoDir, filename);
        if (await exists(candidate)) {
          try {
            const content = await readFile(candidate, 'utf8');
            sections.push(`### ${repo.name}`, '', content.trim(), '');
            break; // only include first found per repo
          } catch { /* skip */ }
        }
      }
    }
  }

  return `<agemon_task_context>\n${sections.join('\n').trim()}\n</agemon_task_context>`;
}

// ─── Plugin symlinks ─────────────────────────────────────────────────────────

async function refreshPluginSymlinks(task: Task, taskDir: string): Promise<void> {
  const pluginsDir = join(taskDir, '.agemonplugins');
  await mkdir(pluginsDir, { recursive: true });
  await pruneStaleSymlinks(pluginsDir, task);

  for (const repo of task.repos) {
    const repoSafe = safeName(repo.name);
    const repoPlugins = join(taskDir, repoSafe, '.claude', 'plugins');
    if (await isRealDirectory(repoPlugins, taskDir)) {
      const linkPath = join(pluginsDir, repoSafe);
      if (!(await exists(linkPath))) {
        await symlink(repoPlugins, linkPath);
      }
    }
  }
}

async function refreshSkillSymlinks(task: Task, taskDir: string): Promise<void> {
  const skillsDir = join(taskDir, '.agemonskills');
  await mkdir(skillsDir, { recursive: true });
  await pruneStaleSymlinks(skillsDir, task);

  for (const repo of task.repos) {
    const repoSafe = safeName(repo.name);
    const repoSkills = join(taskDir, repoSafe, '.claude', 'skills');
    if (await isRealDirectory(repoSkills, taskDir)) {
      const linkPath = join(skillsDir, repoSafe);
      if (!(await exists(linkPath))) {
        await symlink(repoSkills, linkPath);
      }
    }
  }
}

/**
 * Verify a path is a real directory (not a symlink) and lives within the
 * expected parent directory. Guards against malicious repos containing
 * symlinks that escape the worktree to access sensitive host files.
 */
async function isRealDirectory(p: string, parentDir: string): Promise<boolean> {
  try {
    const resolved = resolve(p);
    if (!resolved.startsWith(resolve(parentDir) + '/')) return false;
    const s = await lstat(resolved);
    // If it's a symlink, resolve and check the target is still within parentDir
    if (s.isSymbolicLink()) {
      const target = resolve(await readlink(resolved));
      if (!target.startsWith(resolve(parentDir) + '/')) return false;
      const ts = await stat(target);
      return ts.isDirectory();
    }
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Remove symlinks in dir for repos no longer attached to the task. */
async function pruneStaleSymlinks(dir: string, task: Task): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    console.warn(`[context] failed to read directory ${dir} for symlink pruning:`, err);
    return;
  }

  const validNames = new Set(task.repos.map(r => safeName(r.name)));
  for (const entry of entries) {
    if (!validNames.has(entry)) {
      await rm(join(dir, entry), { recursive: true, force: true });
    }
  }
}

// ─── Agent plugin directory wiring ──────────────────────────────────────────

/**
 * Wire each agent's plugin discovery directory inside the task dir.
 * Reads pluginPaths from agent configs so adding a new agent automatically
 * gets plugin wiring without touching this code.
 */
async function wireAgentPluginDirs(taskDir: string): Promise<void> {
  for (const pluginPath of getAllPluginPaths()) {
    const agentPluginsDir = join(taskDir, pluginPath.taskRelative);
    await mkdir(agentPluginsDir, { recursive: true });

    // _global → ~/.agemon/plugins/
    const globalLink = join(agentPluginsDir, '_global');
    if (!(await exists(globalLink))) {
      await symlink(join(agemonDir(), 'plugins'), globalLink);
    }

    // _task → task-level aggregated plugins
    const taskLink = join(agentPluginsDir, '_task');
    if (!(await exists(taskLink))) {
      await symlink(join(taskDir, '.agemonplugins'), taskLink);
    }
  }
}

// ─── Agent skill directory wiring ───────────────────────────────────────────

/**
 * Wire each agent's skill discovery directory inside the task dir.
 *
 * Claude Code (and most agents per the Agent Skills spec) scan only ONE
 * level deep: they look for immediate child directories containing SKILL.md.
 * So we can't just symlink a parent directory — we must flatten individual
 * skill dirs directly into the agent's discovery path.
 *
 * Strategy: enumerate skill dirs from both .agemonskills/ (repo-level, which
 * itself contains per-repo subdirs of skill dirs) and ~/.agemon/skills/
 * (global), then symlink each individual skill dir into the agent's path.
 * Prune stale links that no longer resolve.
 */
async function wireAgentSkillDirs(taskDir: string): Promise<void> {
  for (const skillPath of getAllSkillPaths()) {
    const agentSkillsDir = join(taskDir, skillPath.taskRelative);
    await mkdir(agentSkillsDir, { recursive: true });

    // Collect individual skill dirs from repo-level aggregation.
    // .agemonskills/{repoSafe}/ contains symlinks to repo .claude/skills/ dirs,
    // each of which contains skill-name/ subdirs with SKILL.md.
    const repoSkillsBase = join(taskDir, '.agemonskills');
    await flattenSkillsInto(agentSkillsDir, repoSkillsBase, '_repo:');

    // Collect individual skill dirs from global ~/.agemon/skills/
    const globalSkillsBase = join(agemonDir(), 'skills');
    await flattenSkillsInto(agentSkillsDir, globalSkillsBase, '_global:');

    // Prune stale symlinks (targets that no longer exist)
    await pruneDeadSymlinks(agentSkillsDir);
  }
}

/**
 * Scan a source directory (which may contain skill dirs directly or
 * subdirectories of skill dirs) and symlink each skill dir into destDir.
 * Link names are prefixed to avoid collisions between sources.
 *
 * Handles two layouts:
 *   source/my-skill/SKILL.md           → direct skill dir
 *   source/org--repo/my-skill/SKILL.md → nested (repo aggregation)
 */
async function flattenSkillsInto(
  destDir: string,
  sourceDir: string,
  prefix: string,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    const childPath = join(sourceDir, entry.name);
    // Resolve symlinks to check if target is a directory
    const isDir = entry.isDirectory() || entry.isSymbolicLink();
    if (!isDir) continue;

    // Check if this child IS a skill dir (has SKILL.md)
    if (await exists(join(childPath, 'SKILL.md'))) {
      const linkName = `${prefix}${entry.name}`;
      const linkPath = join(destDir, linkName);
      if (!(await exists(linkPath))) {
        try { await symlink(childPath, linkPath); } catch { /* skip collisions */ }
      }
      continue;
    }

    // Otherwise, scan one level deeper (e.g. .agemonskills/org--repo/ → skill dirs)
    let subEntries: Dirent[];
    try {
      subEntries = await readdir(childPath, { withFileTypes: true });
    } catch { continue; }

    for (const sub of subEntries) {
      const subPath = join(childPath, sub.name);
      if (!(sub.isDirectory() || sub.isSymbolicLink())) continue;
      if (await exists(join(subPath, 'SKILL.md'))) {
        const linkName = `${prefix}${entry.name}:${sub.name}`;
        const linkPath = join(destDir, linkName);
        if (!(await exists(linkPath))) {
          try { await symlink(subPath, linkPath); } catch { /* skip collisions */ }
        }
      }
    }
  }
}

/** Remove symlinks whose targets no longer exist. */
async function pruneDeadSymlinks(dir: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    try {
      const stat = await lstat(entryPath);
      if (!stat.isSymbolicLink()) continue;
      // Check if target exists
      if (!(await exists(entryPath))) {
        await rm(entryPath, { force: true });
      }
    } catch {
      // If lstat fails, try to remove
      await rm(entryPath, { force: true }).catch(() => {});
    }
  }
}

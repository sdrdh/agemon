/**
 * Task context manager.
 *
 * Generates per-task context artifacts:
 *   - ~/.agemon/tasks/{taskId}/CLAUDE.md          (synthesized from global + repo instructions)
 *   - ~/.agemon/tasks/{taskId}/.agemonplugins/    (symlinks to repo .claude/plugins/)
 *   - ~/.agemon/tasks/{taskId}/.agemonskills/     (symlinks to repo .claude/skills/)
 *   - ~/.agemon/tasks/{taskId}/.claude/plugins/   (wired to global + task plugins)
 *
 * Called at session start and when repos are attached/changed on a task.
 */

import { mkdir, writeFile, symlink, rm, access, readdir } from 'fs/promises';
import { join } from 'path';
import { AGEMON_DIR } from './git.ts';
import type { Task } from '@agemon/shared';

/** Filesystem-safe repo dir name (mirrors git.ts safeName). */
function safeName(repoName: string): string {
  return repoName.replace(/\//g, '--');
}

/** Returns true if path exists. */
async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Generate or refresh all context artifacts for a task.
 * Safe to call multiple times — idempotent. Stale symlinks are pruned.
 */
export async function refreshTaskContext(task: Task): Promise<void> {
  const taskDir = join(AGEMON_DIR, 'tasks', task.id);
  await mkdir(taskDir, { recursive: true });

  await Promise.all([
    generateClaudeMd(task, taskDir),
    refreshPluginSymlinks(task, taskDir),
    refreshSkillSymlinks(task, taskDir),
    wireClaudePluginsDir(taskDir),
  ]);
}

/** Get the task directory path (no I/O). */
export function getTaskDir(taskId: string): string {
  return join(AGEMON_DIR, 'tasks', taskId);
}

// ─── CLAUDE.md ───────────────────────────────────────────────────────────────

async function generateClaudeMd(task: Task, taskDir: string): Promise<void> {
  const lines: string[] = [
    `# Task: ${task.title}`,
    '',
  ];

  if (task.description) {
    lines.push(task.description, '');
  }

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
        if (await exists(candidate)) {
          lines.push(`@${candidate}`);
        }
      }
    }
    lines.push('');
  }

  await writeFile(join(taskDir, 'CLAUDE.md'), lines.join('\n'));
}

// ─── Plugin symlinks ─────────────────────────────────────────────────────────

async function refreshPluginSymlinks(task: Task, taskDir: string): Promise<void> {
  const pluginsDir = join(taskDir, '.agemonplugins');
  await mkdir(pluginsDir, { recursive: true });
  await pruneStaleSymlinks(pluginsDir, task);

  for (const repo of task.repos) {
    const repoSafe = safeName(repo.name);
    const repoPlugins = join(taskDir, repoSafe, '.claude', 'plugins');
    if (await exists(repoPlugins)) {
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
    if (await exists(repoSkills)) {
      const linkPath = join(skillsDir, repoSafe);
      if (!(await exists(linkPath))) {
        await symlink(repoSkills, linkPath);
      }
    }
  }
}

/** Remove symlinks in dir for repos no longer attached to the task. */
async function pruneStaleSymlinks(dir: string, task: Task): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }

  const validNames = new Set(task.repos.map(r => safeName(r.name)));
  for (const entry of entries) {
    if (!validNames.has(entry)) {
      await rm(join(dir, entry), { recursive: true, force: true });
    }
  }
}

// ─── .claude/plugins wiring ──────────────────────────────────────────────────

/**
 * Wire ~/.agemon/tasks/{taskId}/.claude/plugins/ so Claude Code
 * discovers both global agemon plugins and task-level repo plugins.
 */
async function wireClaudePluginsDir(taskDir: string): Promise<void> {
  const claudePluginsDir = join(taskDir, '.claude', 'plugins');
  await mkdir(claudePluginsDir, { recursive: true });

  // _global → ~/.agemon/plugins/
  const globalLink = join(claudePluginsDir, '_global');
  if (!(await exists(globalLink))) {
    await symlink(join(AGEMON_DIR, 'plugins'), globalLink);
  }

  // _task → ../../.agemonplugins/ (relative so it works if dir moves)
  const taskLink = join(claudePluginsDir, '_task');
  if (!(await exists(taskLink))) {
    await symlink(join(taskDir, '.agemonplugins'), taskLink);
  }
}

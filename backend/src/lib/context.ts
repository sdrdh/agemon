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

import { mkdir, writeFile, symlink, rm, access, readdir } from 'fs/promises';
import { join } from 'path';
import { AGEMON_DIR } from './git.ts';
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
    wireAgentPluginDirs(taskDir),
    wireAgentSkillDirs(taskDir),
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
      await symlink(join(AGEMON_DIR, 'plugins'), globalLink);
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
 * Skills are project-scoped (no global equivalent), so we only link
 * the aggregated .agemonskills/ into the agent's expected path.
 */
async function wireAgentSkillDirs(taskDir: string): Promise<void> {
  for (const skillPath of getAllSkillPaths()) {
    const agentSkillsDir = join(taskDir, skillPath.taskRelative);
    await mkdir(agentSkillsDir, { recursive: true });

    // _task → task-level aggregated skills
    const taskLink = join(agentSkillsDir, '_task');
    if (!(await exists(taskLink))) {
      await symlink(join(taskDir, '.agemonskills'), taskLink);
    }

    // _global → ~/.agemon/skills/ (global skills shared across tasks)
    const globalLink = join(agentSkillsDir, '_global');
    if (!(await exists(globalLink))) {
      await symlink(join(AGEMON_DIR, 'skills'), globalLink);
    }
  }
}

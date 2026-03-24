/**
 * Default WorkspaceProvider: prepares the task directory
 * (CLAUDE.md, plugin/skill symlinks, git worktrees).
 * Used when no custom WorkspaceProvider plugin is registered.
 */

import type { WorkspaceProvider, SessionMeta, WorkspaceResult, RepoDiff } from './workspace.ts';
import { getTaskDir, refreshTaskContext } from '../context.ts';
import { db } from '../../db/client.ts';
import { mkdir } from 'fs/promises';
import { gitManager } from '../git.ts';

export const defaultTaskWorkspaceProvider: WorkspaceProvider = {
  async prepare(session: SessionMeta, signal: AbortSignal): Promise<WorkspaceResult> {
    const taskId = session.meta.task_id as string | undefined;
    if (!taskId) {
      // No task — fall through to meta.cwd
      const cwd = session.meta.cwd as string | undefined;
      if (cwd) return { cwd };
      throw new Error('No task_id or cwd in session meta');
    }

    const task = db.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (signal.aborted) throw new Error('Workspace preparation aborted');

    const taskDir = getTaskDir(taskId);
    await mkdir(taskDir, { recursive: true });
    await refreshTaskContext(task);

    return { cwd: taskDir };
  },

  async getDiff(meta: Record<string, unknown>): Promise<RepoDiff[] | null> {
    const taskId = meta.task_id as string | undefined;
    if (!taskId) return null;

    const task = db.getTask(taskId);
    if (!task?.repos) return null;

    const results: RepoDiff[] = [];
    for (const repo of task.repos) {
      try {
        const cwd = gitManager.getWorktreePath(taskId, repo.name);
        const diff = await gitManager.getDiff(taskId, repo.name);
        results.push({ repoName: repo.name, cwd, diff: diff ?? '' });
      } catch {
        // Skip repos where diff fails
      }
    }

    return results.length > 0 ? results : null;
  },
};

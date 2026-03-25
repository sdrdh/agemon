import simpleGit, { type SimpleGit } from 'simple-git';
import { mkdir, rm, access, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { parseRepoName } from '../db/client.ts';

/**
 * GitWorktreeManager handles bare repo caching and per-task worktree lifecycle.
 *
 * Layout:
 *   ~/.agemon/repos/{org}--{repo}.git    — bare repo cache (shared across tasks)
 *   ~/.agemon/tasks/{taskId}/{org}--{repo}/  — worktree per task per repo
 *
 * Branch naming: agemon/{taskId}-{org}-{repo}
 *
 * Override base dir with AGEMON_DIR env var (useful for testing).
 */

export const AGEMON_DIR = process.env.AGEMON_DIR
  ? resolve(process.env.AGEMON_DIR)
  : join(homedir(), '.agemon');

const BASE_DIR = AGEMON_DIR;
const REPOS_DIR = join(BASE_DIR, 'repos');
const TASKS_DIR = join(BASE_DIR, 'tasks');

/** Replace `/` with `--` for filesystem-safe directory names. */
function safeName(repoName: string): string {
  return repoName.replace(/\//g, '--');
}

export class GitWorktreeManager {
  /**
   * Ensures a bare repo exists for the given URL. Clones on first use, fetches on subsequent.
   * Returns the path to the bare repo and a SimpleGit instance for it.
   */
  private async ensureBareRepo(repoUrl: string): Promise<{ barePath: string; git: SimpleGit }> {
    const repoName = parseRepoName(repoUrl);
    const dirName = `${safeName(repoName)}.git`;
    const barePath = join(REPOS_DIR, dirName);

    let exists = false;
    try {
      await access(barePath);
      exists = true;
    } catch {
      // Does not exist yet
    }

    if (exists) {
      // Fetch latest from origin
      const git = simpleGit(barePath);
      await git.fetch(['origin', '--prune']);
      return { barePath, git };
    }

    // Clone bare
    await mkdir(REPOS_DIR, { recursive: true });
    await simpleGit().clone(repoUrl, barePath, ['--bare']);
    const git = simpleGit(barePath);
    return { barePath, git };
  }

  /**
   * Create a worktree for a specific task and repo.
   * Returns the absolute path to the worktree directory.
   */
  async createWorktree(taskId: string, repoUrl: string, baseBranch = 'main'): Promise<string> {
    const { barePath, git } = await this.ensureBareRepo(repoUrl);
    const repoName = parseRepoName(repoUrl);
    const worktreePath = this.getWorktreePath(taskId, repoName);
    const branchName = this.getBranchName(taskId, repoName);

    // If worktree already exists, return its path (idempotent)
    try {
      await access(worktreePath);
      return worktreePath;
    } catch {
      // Does not exist yet — create it
    }

    await mkdir(join(TASKS_DIR, taskId), { recursive: true });

    // Determine the starting point: prefer origin/{baseBranch}, fall back to origin/master
    let startPoint = `origin/${baseBranch}`;
    try {
      await git.raw(['rev-parse', '--verify', startPoint]);
    } catch {
      // baseBranch doesn't exist on remote, try origin/master
      startPoint = 'origin/master';
      try {
        await git.raw(['rev-parse', '--verify', startPoint]);
      } catch {
        // Neither main nor master; use HEAD
        startPoint = 'HEAD';
      }
    }

    await git.raw(['worktree', 'add', '-b', branchName, worktreePath, startPoint]);

    return worktreePath;
  }

  /**
   * Delete a single worktree for a task + repo.
   */
  async deleteWorktree(taskId: string, repoName: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskId, repoName);

    // Find the bare repo to prune from
    const barePath = join(REPOS_DIR, `${safeName(repoName)}.git`);
    let bareExists = false;
    try {
      await access(barePath);
      bareExists = true;
    } catch {
      // Bare repo gone; just remove the directory
    }

    // Remove the worktree directory
    await rm(worktreePath, { recursive: true, force: true });

    // Prune stale worktree references from the bare repo
    if (bareExists) {
      const git = simpleGit(barePath);
      await git.raw(['worktree', 'prune']);
    }
  }

  /**
   * Delete all worktrees for a given task.
   */
  async deleteTaskWorktrees(taskId: string): Promise<void> {
    const taskDir = join(TASKS_DIR, taskId);
    let entries: string[];
    try {
      entries = await readdir(taskDir);
    } catch {
      return; // Task dir doesn't exist; nothing to clean up
    }

    for (const entry of entries) {
      // entry is the safeName of the repo (e.g. "acme--web")
      // Convert back to repo name for deleteWorktree
      const repoName = entry.replace(/--/g, '/');
      await this.deleteWorktree(taskId, repoName);
    }

    // Remove the task directory itself
    await rm(taskDir, { recursive: true, force: true });
  }

  /**
   * Get the git diff (staged + unstaged) for a worktree.
   */
  async getDiff(taskId: string, repoName: string): Promise<string> {
    const worktreePath = this.getWorktreePath(taskId, repoName);
    const git = simpleGit(worktreePath);

    const staged = await git.diff(['--cached']);
    const unstaged = await git.diff([]);

    if (staged && unstaged) {
      return `${staged}\n${unstaged}`;
    }
    return staged || unstaged;
  }

  /**
   * List all worktree paths for a given task.
   */
  async listWorktrees(taskId: string): Promise<string[]> {
    const taskDir = join(TASKS_DIR, taskId);
    let entries: string[];
    try {
      entries = await readdir(taskDir);
    } catch {
      return []; // Task dir doesn't exist
    }

    return entries.map(entry => join(taskDir, entry));
  }

  /**
   * Get the expected filesystem path for a worktree. Pure calculation, no I/O.
   */
  getWorktreePath(taskId: string, repoName: string): string {
    return join(TASKS_DIR, taskId, safeName(repoName));
  }

  /**
   * Get the branch name for a task + repo. Pure calculation, no I/O.
   */
  getBranchName(taskId: string, repoName: string): string {
    const safe = safeName(repoName);
    return `agemon/${taskId}-${safe}`;
  }
}

export const gitManager = new GitWorktreeManager();

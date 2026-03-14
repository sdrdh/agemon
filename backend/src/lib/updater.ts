import { join } from 'path';
import { existsSync } from 'fs';
import { CURRENT_VERSION } from './version.ts';
import type { ReleaseChannel, UpdateResult } from '@agemon/shared';

const PROJECT_ROOT = join(import.meta.dir, '../../..');

// ─── Update Strategy Interface ──────────────────────────────────────────────

interface UpdateStrategy {
  name: 'git' | 'binary';
  applyUpdate(targetRef: string, channel?: ReleaseChannel): Promise<UpdateResult>;
}

// ─── Helper: run a command and return stdout ────────────────────────────────

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

// ─── Git Update Strategy ────────────────────────────────────────────────────

const gitStrategy: UpdateStrategy = {
  name: 'git',
  async applyUpdate(targetRef: string, channel?: ReleaseChannel): Promise<UpdateResult> {
    const base: Omit<UpdateResult, 'ok' | 'message'> = {
      method: 'git',
      from_version: CURRENT_VERSION,
      to_version: targetRef.replace(/^v/, ''),
    };

    // Check for dirty working tree
    const status = await run(['git', 'status', '--porcelain'], PROJECT_ROOT);
    if (!status.ok) {
      return { ...base, ok: false, message: `git status failed: ${status.stderr}` };
    }
    if (status.stdout.length > 0) {
      return { ...base, ok: false, message: 'Working tree is dirty. Commit or stash changes before updating.' };
    }

    // Capture current HEAD for rollback
    const currentHead = (await run(['git', 'rev-parse', 'HEAD'], PROJECT_ROOT)).stdout;

    // Branch tracking: checkout + pull
    if (channel === 'branch') {
      return applyBranchUpdate(targetRef, base, currentHead);
    }

    // Tag-based update: fetch tags, checkout tag
    return applyTagUpdate(targetRef, base, currentHead);
  },
};

async function applyTagUpdate(
  targetTag: string,
  base: Omit<UpdateResult, 'ok' | 'message'>,
  rollbackRef: string,
): Promise<UpdateResult> {
  // Fetch latest tags
  const fetchResult = await run(['git', 'fetch', 'origin', '--tags'], PROJECT_ROOT);
  if (!fetchResult.ok) {
    return { ...base, ok: false, message: `git fetch failed: ${fetchResult.stderr}` };
  }

  // Checkout target tag
  const checkout = await run(['git', 'checkout', targetTag], PROJECT_ROOT);
  if (!checkout.ok) {
    return { ...base, ok: false, message: `git checkout failed: ${checkout.stderr}` };
  }

  // Install dependencies — rollback on failure
  const install = await run(['bun', 'install', '--frozen-lockfile'], PROJECT_ROOT);
  if (!install.ok) {
    await run(['git', 'checkout', rollbackRef], PROJECT_ROOT);
    return { ...base, ok: false, message: `bun install failed: ${install.stderr}. Reverted to previous version.` };
  }

  return { ...base, ok: true, message: `Updated from ${CURRENT_VERSION} to ${targetTag}` };
}

async function applyBranchUpdate(
  branch: string,
  base: Omit<UpdateResult, 'ok' | 'message'>,
  rollbackRef: string,
): Promise<UpdateResult> {
  // Fetch the branch
  const fetchResult = await run(['git', 'fetch', 'origin', branch], PROJECT_ROOT);
  if (!fetchResult.ok) {
    return { ...base, ok: false, message: `git fetch failed: ${fetchResult.stderr}` };
  }

  // Check current branch
  const currentBranch = (await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], PROJECT_ROOT)).stdout;

  if (currentBranch === branch) {
    // Already on the branch — fast-forward pull
    const pull = await run(['git', 'pull', '--ff-only', 'origin', branch], PROJECT_ROOT);
    if (!pull.ok) {
      return { ...base, ok: false, message: `git pull failed: ${pull.stderr}` };
    }
  } else {
    // Switch to the branch
    const checkout = await run(['git', 'checkout', branch], PROJECT_ROOT);
    if (!checkout.ok) {
      // Try creating a local tracking branch
      const checkoutTrack = await run(['git', 'checkout', '-b', branch, `origin/${branch}`], PROJECT_ROOT);
      if (!checkoutTrack.ok) {
        return { ...base, ok: false, message: `git checkout ${branch} failed: ${checkoutTrack.stderr}` };
      }
    }
  }

  // Get the new HEAD for the version label
  const newHead = (await run(['git', 'rev-parse', '--short', 'HEAD'], PROJECT_ROOT)).stdout;

  // Install dependencies — rollback on failure
  const install = await run(['bun', 'install', '--frozen-lockfile'], PROJECT_ROOT);
  if (!install.ok) {
    await run(['git', 'checkout', rollbackRef], PROJECT_ROOT);
    return { ...base, ok: false, message: `bun install failed: ${install.stderr}. Reverted to previous version.` };
  }

  return {
    ...base,
    to_version: `${branch}@${newHead}`,
    ok: true,
    message: `Switched to branch ${branch} (${newHead})`,
  };
}

// ─── Binary Update Strategy (stub) ─────────────────────────────────────────

const binaryStrategy: UpdateStrategy = {
  name: 'binary',
  async applyUpdate(targetRef: string): Promise<UpdateResult> {
    return {
      ok: false,
      method: 'binary',
      from_version: CURRENT_VERSION,
      to_version: targetRef.replace(/^v/, ''),
      message: 'Binary update not yet supported',
    };
  },
};

// ─── Factory ────────────────────────────────────────────────────────────────

export function getUpdateStrategy(): UpdateStrategy {
  if (existsSync(join(PROJECT_ROOT, '.git'))) {
    return gitStrategy;
  }
  return binaryStrategy;
}

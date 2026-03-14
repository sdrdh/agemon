import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReleaseChannel, VersionCheckResult } from '@agemon/shared';

// ─── Current Version ─────────────────────────────────────────────────────────

const PROJECT_ROOT = join(import.meta.dir, '../../..');
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
export const CURRENT_VERSION: string = pkg.version;

const GITHUB_REPO = 'sdrdh/agemon';

// ─── Systemd Detection ──────────────────────────────────────────────────────

export function isRunningUnderSystemd(): boolean {
  return !!process.env.INVOCATION_ID;
}

// ─── Semver Comparison ──────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const parts = v.replace(/^v/, '').split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns true if b is newer than a. */
function isNewer(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (bMaj !== aMaj) return bMaj > aMaj;
  if (bMin !== aMin) return bMin > aMin;
  return bPat > aPat;
}

// ─── GitHub API Helpers ─────────────────────────────────────────────────────

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'agemon-updater',
  };
  const pat = process.env.GITHUB_PAT;
  if (pat) headers['Authorization'] = `Bearer ${pat}`;
  return headers;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
}

/** Fetch latest stable release (skips pre-releases). */
async function fetchStableRelease(): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  return res.json() as Promise<GitHubRelease>;
}

/** Fetch latest pre-release. Falls back to latest stable if no pre-release exists. */
async function fetchPreRelease(): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  const releases = await res.json() as GitHubRelease[];
  const preRelease = releases.find(r => r.prerelease);
  if (preRelease) return preRelease;
  // No pre-release found — fall back to first non-draft release
  const stable = releases.find(r => !r.prerelease);
  if (stable) return stable;
  throw new Error('No releases found');
}

/** Fetch latest nightly tag (convention: nightly-YYYY-MM-DD or nightly-*). */
async function fetchNightlyRelease(): Promise<GitHubRelease> {
  // Check for nightly releases first
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=50`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  const releases = await res.json() as GitHubRelease[];
  const nightly = releases.find(r => r.tag_name.startsWith('nightly'));
  if (nightly) return nightly;

  // Fall back to git tags matching nightly-*
  const tagsRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/matching-refs/tags/nightly`, {
    headers: githubHeaders(),
  });
  if (tagsRes.ok) {
    const tags = await tagsRes.json() as { ref: string }[];
    if (tags.length > 0) {
      const latestTag = tags[tags.length - 1].ref.replace('refs/tags/', '');
      return {
        tag_name: latestTag,
        published_at: new Date().toISOString(),
        html_url: `https://github.com/${GITHUB_REPO}/releases/tag/${latestTag}`,
        prerelease: true,
      };
    }
  }

  throw new Error('No nightly releases or tags found');
}

/**
 * Check if a remote branch has commits ahead of the current HEAD.
 * Returns a synthetic "release" representing the branch tip.
 */
async function fetchBranchHead(branch: string): Promise<GitHubRelease & { commit_sha: string }> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/branches/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`Branch "${branch}" not found (${res.status})`);
  const data = await res.json() as {
    commit: { sha: string; commit: { committer: { date: string }; message: string } };
  };

  return {
    tag_name: branch,
    published_at: data.commit.commit.committer.date,
    html_url: `https://github.com/${GITHUB_REPO}/tree/${branch}`,
    prerelease: true,
    commit_sha: data.commit.sha,
  };
}

// ─── Local Git HEAD ─────────────────────────────────────────────────────────

async function getLocalHead(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

// ─── Update Check with Cache ────────────────────────────────────────────────

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
let cachedResult: VersionCheckResult | null = null;
let cachedAt = 0;
let cachedChannel: string = '';

export async function checkForUpdates(refresh?: boolean, channel?: ReleaseChannel, branch?: string): Promise<VersionCheckResult> {
  const resolvedChannel = channel ?? 'stable';
  const cacheKey = resolvedChannel === 'branch' ? `branch:${branch ?? ''}` : resolvedChannel;

  if (!refresh && cachedResult && (Date.now() - cachedAt) < CACHE_TTL && cachedChannel === cacheKey) {
    return cachedResult;
  }

  const now = new Date().toISOString();

  try {
    let result: VersionCheckResult;

    if (resolvedChannel === 'branch') {
      if (!branch) throw new Error('Branch name is required when channel is "branch"');
      result = await checkBranch(branch, now);
    } else {
      result = await checkRelease(resolvedChannel, now);
    }

    cachedResult = result;
    cachedAt = Date.now();
    cachedChannel = cacheKey;
    return result;
  } catch (err) {
    const result: VersionCheckResult = {
      current: CURRENT_VERSION,
      latest: CURRENT_VERSION,
      latest_tag: `v${CURRENT_VERSION}`,
      has_update: false,
      should_notify: false,
      published_at: '',
      release_url: '',
      checked_at: now,
      channel: resolvedChannel,
      error: (err as Error).message,
    };

    cachedResult = result;
    cachedAt = Date.now();
    cachedChannel = cacheKey;
    return result;
  }
}

async function checkRelease(channel: ReleaseChannel, now: string): Promise<VersionCheckResult> {
  let release: GitHubRelease;
  switch (channel) {
    case 'pre-release':
      release = await fetchPreRelease();
      break;
    case 'nightly':
      release = await fetchNightlyRelease();
      break;
    default:
      release = await fetchStableRelease();
      break;
  }

  const latestTag = release.tag_name;
  const latestVersion = latestTag.replace(/^v/, '');
  const publishedAt = release.published_at;

  // For nightly tags (nightly-YYYY-MM-DD), always consider it an "update" if tag differs
  const hasUpdate = latestTag.startsWith('nightly')
    ? latestTag !== `v${CURRENT_VERSION}` && latestTag !== CURRENT_VERSION
    : isNewer(CURRENT_VERSION, latestVersion);

  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  const shouldNotify = hasUpdate && (Date.now() - new Date(publishedAt).getTime()) > fiveDaysMs;

  return {
    current: CURRENT_VERSION,
    latest: latestVersion,
    latest_tag: latestTag,
    has_update: hasUpdate,
    should_notify: shouldNotify,
    published_at: publishedAt,
    release_url: release.html_url,
    checked_at: now,
    channel,
  };
}

async function checkBranch(branch: string, now: string): Promise<VersionCheckResult> {
  const branchInfo = await fetchBranchHead(branch);
  const localHead = await getLocalHead();
  const hasUpdate = branchInfo.commit_sha !== localHead;

  return {
    current: CURRENT_VERSION,
    latest: `${branch}@${branchInfo.commit_sha.slice(0, 7)}`,
    latest_tag: branch, // updater uses this as the git ref
    has_update: hasUpdate,
    should_notify: hasUpdate,
    published_at: branchInfo.published_at,
    release_url: branchInfo.html_url,
    checked_at: now,
    channel: 'branch',
  };
}

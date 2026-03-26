import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import { simpleGit } from 'simple-git';
import { db } from '../db/client.ts';
import { workspaceRegistry } from '../lib/extensions/workspace-registry.ts';
import { gitManager } from '../lib/git.ts';
import type { RepoDiff } from '../lib/extensions/workspace.ts';
import { readFsTree } from '../lib/fs-tree.ts';

export const tasksRoutes = new Hono();

function parseWorkspace(workspaceJson: string | null | undefined): { provider: string; config: Record<string, unknown> } {
  try {
    if (workspaceJson) return JSON.parse(workspaceJson);
  } catch { /* fall through */ }
  return { provider: 'git-worktree', config: {} };
}

async function getDiffRepos(providerName: string, meta: Record<string, unknown>): Promise<RepoDiff[]> {
  const provider = workspaceRegistry.get(providerName);
  if (!provider?.getDiff) return [];
  return (await provider.getDiff(meta)) ?? [];
}

/**
 * Resolve the git repo root for a session + repo name.
 * - Task sessions: uses gitManager.getWorktreePath(taskId, repoName)
 * - Standalone cwd sessions (single-repo): repoName is the basename of cwd, return cwd directly.
 * - Standalone cwd sessions (multi-repo): repoName is a subdirectory, return join(cwd, repoName).
 */
function resolveRepoCwd(sessionId: string, repoName: string): string | null {
  const session = db.getSession(sessionId);
  if (!session) return null;
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const taskId = meta.task_id as string | undefined;
  if (taskId) {
    if (!repoName) return null;
    return gitManager.getWorktreePath(taskId, repoName);
  }
  const cwd = meta.cwd as string | undefined;
  if (!cwd) return null;
  // For multi-repo cwd sessions, repoName is a subdirectory of cwd.
  // For single-repo, repoName is the basename of cwd itself — return cwd directly.
  if (repoName && repoName !== basename(cwd)) {
    return join(cwd, repoName);
  }
  return cwd;
}

/** Resolves the filesystem root for a session — uses session.meta.cwd directly. */
function resolveSessionRoot(sessionId: string): string | null {
  const session = db.getSession(sessionId);
  if (!session) return null;
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  return (meta.cwd as string | undefined) ?? null;
}

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

/** Creates an SSE ReadableStream that polls for diffs until inactive or aborted.
 *  Sends a `diff` event only when the data changes; otherwise sends a `heartbeat`
 *  every 30 seconds to keep the connection alive. */
function createDiffStream(
  signal: AbortSignal,
  getRepos: () => Promise<RepoDiff[]>,
  isActive: () => boolean,
): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();
      let lastPayload = '';
      let lastSentAt = 0;

      const enqueue = (data: string) => {
        if (!closed) controller.enqueue(encoder.encode(data));
      };

      const sendUpdate = async () => {
        try {
          const repos = await getRepos();
          const payload = JSON.stringify({ repos });
          const now = Date.now();
          if (payload !== lastPayload) {
            lastPayload = payload;
            lastSentAt = now;
            enqueue(`event: diff\ndata: ${payload}\n\n`);
          } else if (now - lastSentAt >= HEARTBEAT_INTERVAL_MS) {
            lastSentAt = now;
            enqueue(`event: heartbeat\ndata: \n\n`);
          }
        } catch (err) {
          enqueue(`event: error\ndata: ${err instanceof Error ? err.message : String(err)}\n\n`);
        }
      };

      sendUpdate();

      const pollInterval = setInterval(() => {
        if (!isActive()) {
          clearInterval(pollInterval);
          enqueue(`event: done\ndata: \n\n`);
          return;
        }
        sendUpdate();
      }, POLL_INTERVAL_MS);

      signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        closed = true;
        controller.close();
      });
    },
  });
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};


function resolveSessionDiffMeta(session: { meta_json?: string | null }): { provider: string; meta: Record<string, unknown> } {
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const taskId = meta.task_id as string | undefined;
  if (taskId) {
    // Task session: use the task's workspace_json (same as /tasks/:id/diff)
    const task = db.getTask(taskId);
    const workspace = parseWorkspace(task?.workspace_json);
    return { provider: workspace.provider, meta: { task_id: taskId, ...workspace.config } };
  }
  // Standalone cwd session
  return { provider: (meta.workspaceProvider as string | undefined) ?? 'cwd', meta };
}

// GET /sessions/:id/diff
tasksRoutes.get('/sessions/:id/diff', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const { provider, meta } = resolveSessionDiffMeta(session);
  const repos = await getDiffRepos(provider, meta);
  return c.json({ repos });
});

// GET /sessions/:id/diff/stream
tasksRoutes.get('/sessions/:id/diff/stream', (c) => {
  const sessionId = c.req.param('id');

  const stream = createDiffStream(
    c.req.raw.signal,
    () => {
      const session = db.getSession(sessionId);
      if (!session) throw new Error('Session not found');
      const { provider, meta } = resolveSessionDiffMeta(session);
      return getDiffRepos(provider, meta);
    },
    () => {
      const session = db.getSession(sessionId);
      return !!session && (session.state === 'running' || session.state === 'ready');
    },
  );

  return new Response(stream, { headers: SSE_HEADERS });
});

// ─── Commit history ──────────────────────────────────────────────────────────────

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// GET /sessions/:id/file?path=...&repo=...
tasksRoutes.get('/sessions/:id/file', async (c) => {
  const sessionId = c.req.param('id');
  const filePath = c.req.query('path');
  const repoName = c.req.query('repo') ?? '';
  if (!filePath) return c.json({ error: 'Missing path query parameter' }, 400);

  // If repo provided, use git-aware resolution (existing behaviour)
  if (repoName) {
    const cwd = resolveRepoCwd(sessionId, repoName);
    if (!cwd) return c.json({ error: 'Session not found, no cwd, or invalid repo' }, 404);
    const git = simpleGit(cwd);
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) return c.json({ error: 'Not a git repository' }, 400);
    let oldContent = '';
    try { oldContent = await git.show([`HEAD:${filePath}`]); } catch { /* new file */ }
    let newContent = '';
    try { newContent = await readFile(join(cwd, filePath), 'utf-8'); } catch { /* deleted */ }
    return c.json({ oldContent, newContent });
  }

  // No repo — direct file read from session cwd, no git diff
  const root = resolveSessionRoot(sessionId);
  if (!root) return c.json({ error: 'Session not found or has no cwd' }, 404);
  let newContent = '';
  try { newContent = await readFile(join(root, filePath), 'utf-8'); } catch { /* missing */ }
  return c.json({ oldContent: '', newContent });
});

// GET /sessions/:id/refs?repo=...
tasksRoutes.get('/sessions/:id/refs', async (c) => {
  const sessionId = c.req.param('id');
  const repoName = c.req.query('repo') ?? '';

  const cwd = resolveRepoCwd(sessionId, repoName);
  if (!cwd) return c.json({ error: 'Session not found or no working directory' }, 404);

  try {
    const git = simpleGit(cwd);
    const currentBranch = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const branchOutput = await git.raw(['branch', '-a', '--format=%(refname:short)']);
    const allRefs = branchOutput.trim().split('\n').filter(Boolean);

    const local: string[] = [];
    const remote: string[] = [];
    const seen = new Set<string>();
    for (const ref of allRefs) {
      if (ref === currentBranch) continue;
      const clean = ref.replace(/^remotes\//, '');
      if (seen.has(clean)) continue;
      seen.add(clean);
      if (clean.startsWith('origin/')) remote.push(clean);
      else local.push(clean);
    }

    let defaultBase = '';
    for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
      if (seen.has(ref)) { defaultBase = ref; break; }
    }

    return c.json({ currentBranch, defaultBase, local, remote });
  } catch (err) {
    return c.json({ error: 'Failed to list refs', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /sessions/:id/commits?repo=...&base=...
tasksRoutes.get('/sessions/:id/commits', async (c) => {
  const sessionId = c.req.param('id');
  const requestedBase = c.req.query('base') || '';
  const repoName = c.req.query('repo') ?? '';

  const cwd = resolveRepoCwd(sessionId, repoName);
  if (!cwd) return c.json({ error: 'Session not found or no working directory' }, 404);

  try {
    const git = simpleGit(cwd);

    let baseSha = '';
    let baseRef = '';
    if (requestedBase) {
      try {
        baseSha = (await git.raw(['merge-base', 'HEAD', requestedBase])).trim();
        baseRef = requestedBase;
      } catch {
        return c.json({ error: `Invalid base ref: ${requestedBase}` }, 400);
      }
    } else {
      for (const ref of ['origin/main', 'origin/master']) {
        try {
          baseSha = (await git.raw(['merge-base', 'HEAD', ref])).trim();
          baseRef = ref;
          break;
        } catch { /* try next */ }
      }
    }
    if (!baseSha) {
      try {
        baseSha = (await git.raw(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
        baseRef = baseRef || 'root';
      } catch { /* empty repo */ }
    }

    const baseShortSha = baseSha ? baseSha.slice(0, 7) : '';
    let baseMessage = '';
    if (baseSha) {
      try { baseMessage = (await git.raw(['log', '-1', '--format=%s', baseSha])).trim(); } catch { /* ignore */ }
    }

    type LogEntry = { sha: string; shortSha: string; message: string; author: string; date: string };
    const logResult = await git.log<LogEntry>({
      format: { sha: '%H', shortSha: '%h', message: '%s', author: '%an', date: '%ai' },
      from: baseSha || undefined,
      to: 'HEAD',
      symmetric: false,
      '--numstat': null,
    } as any);

    const commits = logResult.all.map(c => ({
      sha: c.sha,
      shortSha: c.shortSha,
      message: c.message,
      author: c.author,
      date: c.date,
      additions: (c as any).diff?.insertions ?? 0,
      deletions: (c as any).diff?.deletions ?? 0,
      filesChanged: (c as any).diff?.changed ?? 0,
    }));

    return c.json({ commits, baseSha, baseRef, baseShortSha, baseMessage });
  } catch (err) {
    return c.json({ error: 'Failed to list commits', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /sessions/:id/commits/:sha/diff?repo=...&to=<sha>
tasksRoutes.get('/sessions/:id/commits/:sha/diff', async (c) => {
  const sessionId = c.req.param('id');
  const sha = c.req.param('sha');
  const toSha = c.req.query('to');
  const repoName = c.req.query('repo') ?? '';

  const cwd = resolveRepoCwd(sessionId, repoName);
  if (!cwd) return c.json({ error: 'Session not found or no working directory' }, 404);

  try {
    const git = simpleGit(cwd);
    let diff: string;
    if (toSha) {
      diff = await git.diff(['-U20', sha, toSha]);
    } else {
      try {
        diff = await git.diff(['-U20', `${sha}^`, sha]);
      } catch {
        diff = await git.diff(['-U20', EMPTY_TREE_SHA, sha]);
      }
    }
    return c.json({ raw: diff });
  } catch (err) {
    return c.json({ error: 'Failed to get commit diff', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /sessions/:id/fs?path=&depth=
tasksRoutes.get('/sessions/:id/fs', async (c) => {
  const sessionId = c.req.param('id');
  const relPath = c.req.query('path') ?? '';
  const depth = Math.min(Number(c.req.query('depth') ?? 2), 5);

  const root = resolveSessionRoot(sessionId);
  if (!root) return c.json({ error: 'Session not found or has no cwd' }, 404);

  try {
    const entries = await readFsTree(root, relPath, depth);
    return c.json({ path: relPath, entries });
  } catch (err) {
    if ((err as Error).message === 'Path traversal detected') {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to read directory' }, 500);
  }
});

// GET /fs/file?path=  (general file read — path relative to ~, must stay under ~)
tasksRoutes.get('/fs/file', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'Missing path' }, 400);

  // Reject absolute paths — filePath must be relative to home dir
  if (filePath.startsWith('/')) return c.json({ error: 'Invalid path' }, 400);

  const root = homedir();
  const abs = resolve(join(root, filePath));
  if (abs !== root && !abs.startsWith(root + '/')) return c.json({ error: 'Invalid path' }, 400);

  try {
    const content = await readFile(abs, 'utf-8');
    return c.json({ content });
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
});

// GET /fs?path=&depth=  (general — root = ~)
tasksRoutes.get('/fs', async (c) => {
  const root = homedir();
  const relPath = c.req.query('path') ?? '';
  const depth = Math.min(Number(c.req.query('depth') ?? 2), 5);

  try {
    const entries = await readFsTree(root, relPath, depth);
    return c.json({ path: relPath, entries });
  } catch (err) {
    if ((err as Error).message === 'Path traversal detected') {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to read directory' }, 500);
  }
});

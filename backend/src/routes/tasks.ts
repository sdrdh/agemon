import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { simpleGit } from 'simple-git';
import { db } from '../db/client.ts';
import { workspaceRegistry } from '../lib/plugins/workspace-registry.ts';
import { gitManager } from '../lib/git.ts';
import type { RepoDiff } from '../lib/plugins/workspace.ts';

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
 * - Standalone cwd sessions: single-repo by definition, returns meta.cwd (repoName ignored)
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
  return (meta.cwd as string) ?? null;
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
          enqueue(`event: error\ndata: ${(err as Error).message}\n\n`);
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

// GET /tasks/:id/diff
tasksRoutes.get('/tasks/:id/diff', async (c) => {
  const taskId = c.req.param('id');
  const task = db.getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const workspace = parseWorkspace(task.workspace_json);
  const repos = await getDiffRepos(workspace.provider, { task_id: taskId, ...workspace.config });
  return c.json({ repos });
});

// GET /tasks/:id/diff/stream
tasksRoutes.get('/tasks/:id/diff/stream', (c) => {
  const taskId = c.req.param('id');

  const stream = createDiffStream(
    c.req.raw.signal,
    () => {
      const task = db.getTask(taskId);
      if (!task) throw new Error('Task not found');
      const workspace = parseWorkspace(task.workspace_json);
      return getDiffRepos(workspace.provider, { task_id: taskId, ...workspace.config });
    },
    () => {
      const sessions = db.listSessions(taskId);
      return sessions.some(s => s.state === 'running' || s.state === 'ready');
    },
  );

  return new Response(stream, { headers: SSE_HEADERS });
});

// GET /sessions/:id/diff
tasksRoutes.get('/sessions/:id/diff', async (c) => {
  const sessionId = c.req.param('id');
  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const providerName = meta.workspace?.provider ?? 'cwd';
  const config = meta.workspace?.config ?? {};

  const repos = await getDiffRepos(providerName, { ...meta, ...config });
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
      const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
      const providerName = meta.workspace?.provider ?? 'cwd';
      const config = meta.workspace?.config ?? {};
      return getDiffRepos(providerName, { ...meta, ...config });
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

  const cwd = resolveRepoCwd(sessionId, repoName);
  if (!cwd) return c.json({ error: 'Session not found, no cwd, or missing repo param' }, 404);

  const git = simpleGit(cwd);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) return c.json({ error: 'Not a git repository' }, 400);

  let oldContent = '';
  try { oldContent = await git.show([`HEAD:${filePath}`]); } catch { /* new file */ }

  let newContent = '';
  try { newContent = await readFile(join(cwd, filePath), 'utf-8'); } catch { /* deleted file */ }

  return c.json({ oldContent, newContent });
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
    return c.json({ error: 'Failed to list refs', details: (err as Error).message }, 500);
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

    const range = baseSha ? `${baseSha}..HEAD` : 'HEAD';
    const logOutput = await git.raw(['log', '--format=COMMIT %H %h %an%n%ai%n%s', '--numstat', range]);

    if (!logOutput.trim()) return c.json({ commits: [], baseSha, baseRef, baseShortSha, baseMessage });

    const commits: {
      sha: string; shortSha: string; message: string;
      author: string; date: string;
      additions: number; deletions: number; filesChanged: number;
    }[] = [];

    for (const block of logOutput.split(/^COMMIT /m).filter(Boolean)) {
      const lines = block.split('\n');
      const headerMatch = lines[0].match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!headerMatch) continue;
      const [, sha, shortSha, author] = headerMatch;
      const date = (lines[1] || '').trim();
      const message = (lines[2] || '').trim();

      let additions = 0, deletions = 0, filesChanged = 0;
      for (let i = 3; i < lines.length; i++) {
        const m = lines[i].match(/^(\d+|-)\t(\d+|-)\t/);
        if (m) {
          if (m[1] !== '-') additions += parseInt(m[1], 10);
          if (m[2] !== '-') deletions += parseInt(m[2], 10);
          filesChanged++;
        }
      }
      commits.push({ sha, shortSha, message, author, date, additions, deletions, filesChanged });
    }

    return c.json({ commits, baseSha, baseRef, baseShortSha, baseMessage });
  } catch (err) {
    return c.json({ error: 'Failed to list commits', details: (err as Error).message }, 500);
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
    return c.json({ error: 'Failed to get commit diff', details: (err as Error).message }, 500);
  }
});

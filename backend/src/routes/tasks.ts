import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { simpleGit } from 'simple-git';
import { db } from '../db/client.ts';
import { workspaceRegistry } from '../lib/plugins/workspace-registry.ts';

export const tasksRoutes = new Hono();

async function getDiffFromProvider(providerName: string, meta: Record<string, unknown>) {
  const provider = workspaceRegistry.get(providerName);
  if (!provider?.getDiff) return null;
  return provider.getDiff({
    sessionId: '',
    agentType: '',
    meta,
  });
}

// GET /tasks/:id/diff
tasksRoutes.get('/tasks/:id/diff', async (c) => {
  const taskId = c.req.param('id');

  const task = db.getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const workspace = task.workspace_json
    ? JSON.parse(task.workspace_json)
    : { provider: 'git-worktree', config: {} };

  const diff = await getDiffFromProvider(workspace.provider, { task_id: taskId, ...workspace.config });
  if (!diff) return c.json({ raw: '' });

  return c.json({ raw: diff });
});

// GET /tasks/:id/diff/stream
tasksRoutes.get('/tasks/:id/diff/stream', async (c) => {
  const taskId = c.req.param('id');

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendUpdate = async () => {
        try {
          const task = db.getTask(taskId);
          if (!task) {
            controller.enqueue(encoder.encode(`event: error\ndata: Task not found\n\n`));
            return;
          }

          const workspace = task.workspace_json
            ? JSON.parse(task.workspace_json)
            : { provider: 'git-worktree', config: {} };

          const diff = await getDiffFromProvider(workspace.provider, { task_id: taskId, ...workspace.config });
          const payload = JSON.stringify({ raw: diff ?? '' });
          controller.enqueue(encoder.encode(`event: diff\ndata: ${payload}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${(err as Error).message}\n\n`));
        }
      };

      sendUpdate();

      const pollInterval = setInterval(async () => {
        const sessions = db.listSessions(taskId);
        const hasRunning = sessions.some(s => s.state === 'running' || s.state === 'ready');

        if (!hasRunning) {
          clearInterval(pollInterval);
          controller.enqueue(encoder.encode(`event: done\ndata: \n\n`));
          return;
        }

        sendUpdate();
      }, 2000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * Resolve the working directory for a session.
 * Task sessions: resolve from task workspace config.
 * Standalone sessions: resolve from meta_json.cwd.
 */
function resolveSessionCwd(sessionId: string): string | null {
  const session = db.getSession(sessionId);
  if (!session) return null;
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  return (meta.cwd as string) ?? null;
}

// GET /sessions/:id/file?path=...  — full file contents (old from HEAD, new from working tree)
tasksRoutes.get('/sessions/:id/file', async (c) => {
  const sessionId = c.req.param('id');
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'Missing path query parameter' }, 400);

  const cwd = resolveSessionCwd(sessionId);
  if (!cwd) return c.json({ error: 'Session not found or no cwd' }, 404);

  const git = simpleGit(cwd);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) return c.json({ error: 'Not a git repository' }, 400);

  // Old content: from HEAD (committed version)
  let oldContent = '';
  try {
    oldContent = await git.show([`HEAD:${filePath}`]);
  } catch {
    // File might be new (not in HEAD)
    oldContent = '';
  }

  // New content: from working tree
  let newContent = '';
  try {
    newContent = await readFile(join(cwd, filePath), 'utf-8');
  } catch {
    // File might be deleted
    newContent = '';
  }

  return c.json({ oldContent, newContent });
});

// GET /sessions/:id/diff
tasksRoutes.get('/sessions/:id/diff', async (c) => {
  const sessionId = c.req.param('id');

  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const providerName = meta.workspace?.provider ?? 'cwd';
  const config = meta.workspace?.config ?? {};

  const diff = await getDiffFromProvider(providerName, { ...meta, ...config });
  if (!diff) return c.json({ raw: '' });

  return c.json({ raw: diff });
});

// GET /sessions/:id/diff/stream
tasksRoutes.get('/sessions/:id/diff/stream', async (c) => {
  const sessionId = c.req.param('id');

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendUpdate = async () => {
        try {
          const session = db.getSession(sessionId);
          if (!session) {
            controller.enqueue(encoder.encode(`event: error\ndata: Session not found\n\n`));
            return;
          }

          const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
          const providerName = meta.workspace?.provider ?? 'cwd';
          const config = meta.workspace?.config ?? {};

          const diff = await getDiffFromProvider(providerName, { ...meta, ...config });
          const payload = JSON.stringify({ raw: diff ?? '' });
          controller.enqueue(encoder.encode(`event: diff\ndata: ${payload}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${(err as Error).message}\n\n`));
        }
      };

      sendUpdate();

      const pollInterval = setInterval(async () => {
        const session = db.getSession(sessionId);
        if (!session || (session.state !== 'running' && session.state !== 'ready')) {
          clearInterval(pollInterval);
          controller.enqueue(encoder.encode(`event: done\ndata: \n\n`));
          return;
        }
        sendUpdate();
      }, 2000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// ─── Commit history ──────────────────────────────────────────────────────────────

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// GET /sessions/:id/commits — list commits ahead of base branch
tasksRoutes.get('/sessions/:id/commits', async (c) => {
  const sessionId = c.req.param('id');

  const cwd = resolveSessionCwd(sessionId);
  if (!cwd) return c.json({ error: 'Session not found or no working directory' }, 404);

  try {
    const git = simpleGit(cwd);

    // Find the merge-base with origin/main or origin/master
    let baseSha = '';
    for (const ref of ['origin/main', 'origin/master']) {
      try {
        baseSha = (await git.raw(['merge-base', 'HEAD', ref])).trim();
        break;
      } catch { /* try next */ }
    }
    if (!baseSha) {
      // Fallback: first commit in repo (show all history)
      try {
        baseSha = (await git.raw(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
      } catch { /* empty repo */ }
    }

    const range = baseSha ? `${baseSha}..HEAD` : 'HEAD';

    // Single git log with numstat to avoid N+1 queries
    // Format: commit line, then numstat lines, separated by empty line
    const logOutput = await git.raw([
      'log', '--format=COMMIT %H %h %an%n%ai%n%s', '--numstat', range,
    ]);

    if (!logOutput.trim()) return c.json({ commits: [], baseSha });

    const commits: {
      sha: string; shortSha: string; message: string;
      author: string; date: string;
      additions: number; deletions: number; filesChanged: number;
    }[] = [];

    // Parse the interleaved output
    const blocks = logOutput.split(/^COMMIT /m).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n');
      // First line: sha shortSha author
      const headerMatch = lines[0].match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!headerMatch) continue;
      const [, sha, shortSha, author] = headerMatch;
      const date = (lines[1] || '').trim();
      const message = (lines[2] || '').trim();

      // numstat lines follow after blank line
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

    return c.json({ commits, baseSha });
  } catch (err) {
    return c.json({ error: 'Failed to list commits', details: (err as Error).message }, 500);
  }
});

// GET /sessions/:id/commits/:sha/diff — diff for a single commit
tasksRoutes.get('/sessions/:id/commits/:sha/diff', async (c) => {
  const sessionId = c.req.param('id');
  const sha = c.req.param('sha');

  const cwd = resolveSessionCwd(sessionId);
  if (!cwd) return c.json({ error: 'Session not found or no working directory' }, 404);

  try {
    const git = simpleGit(cwd);

    // Try sha^..sha first; for root commits, diff against empty tree
    let diff: string;
    try {
      diff = await git.raw(['diff', '-U20', `${sha}^`, sha]);
    } catch {
      diff = await git.raw(['diff', '-U20', EMPTY_TREE_SHA, sha]);
    }

    return c.json({ raw: diff });
  } catch (err) {
    return c.json({ error: 'Failed to get commit diff', details: (err as Error).message }, 500);
  }
});

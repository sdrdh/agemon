import { Hono } from 'hono';
import { parsePatchFiles } from '@pierre/diffs';
import { db } from '../db/client.ts';
import { workspaceRegistry } from '../lib/plugins/workspace-registry.ts';

export const tasksRoutes = new Hono();

interface DiffFileStats {
  path: string;
  additions: number;
  deletions: number;
}

function parseDiffStats(diff: string): DiffFileStats[] {
  const files: DiffFileStats[] = [];
  try {
    const parsed = parsePatchFiles(diff);
    for (const patch of parsed) {
      for (const file of patch.files) {
        let additions = 0;
        let deletions = 0;
        for (const hunk of file.hunks) {
          additions += hunk.additionLines;
          deletions += hunk.deletionLines;
        }
        files.push({ path: file.name, additions, deletions });
      }
    }
  } catch {
    // Ignore parse errors
  }
  return files;
}

async function getDiffFromProvider(providerName: string, meta: Record<string, unknown>) {
  const provider = workspaceRegistry.get(providerName);
  if (!provider?.getDiff) return null;
  return provider.getDiff({
    sessionId: '',
    agentType: '',
    meta,
  });
}

function buildResponse(diff: string | null) {
  if (!diff) return { repos: [], raw: '' };

  const files = parseDiffStats(diff);
  const byRepo = new Map<string, DiffFileStats[]>();
  for (const file of files) {
    const repo = file.path.split('/')[0] || 'root';
    const existing = byRepo.get(repo) || [];
    existing.push(file);
    byRepo.set(repo, existing);
  }

  const repos = Array.from(byRepo.entries()).map(([name, files]) => ({ name, files }));
  return { repos, raw: diff };
}

// GET /tasks/:id/diff
tasksRoutes.get('/tasks/:id/diff', async (c) => {
  const taskId = c.req.param('id');
  const format = c.req.query('format') || 'unified';

  const task = db.getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const workspace = task.workspace_json
    ? JSON.parse(task.workspace_json)
    : { provider: 'git-worktree', config: {} };

  const diff = await getDiffFromProvider(workspace.provider, { task_id: taskId, ...workspace.config });
  if (!diff) return c.json({ changes: [] });

  if (format === 'structured') {
    return c.json(buildResponse(diff));
  }

  return c.text(diff);
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
          const payload = JSON.stringify(buildResponse(diff ?? ''));
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

// GET /sessions/:id/diff — for non-task sessions
tasksRoutes.get('/sessions/:id/diff', async (c) => {
  const sessionId = c.req.param('id');
  const format = c.req.query('format') || 'unified';

  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Get workspace from session meta
  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};
  const providerName = meta.workspace?.provider ?? 'cwd';
  const config = meta.workspace?.config ?? {};

  const diff = await getDiffFromProvider(providerName, { ...meta, ...config });
  if (!diff) return c.json({ changes: [] });

  if (format === 'structured') {
    return c.json(buildResponse(diff));
  }

  return c.text(diff);
});

// GET /sessions/:id/diff/stream — for non-task sessions
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
          const payload = JSON.stringify(buildResponse(diff ?? ''));
          controller.enqueue(encoder.encode(`event: diff\ndata: ${payload}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${(err as Error).message}\n\n`));
        }
      };

      sendUpdate();

      // Poll while session is running
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

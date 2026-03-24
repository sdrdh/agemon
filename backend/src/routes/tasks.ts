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

  const repos = Array.from(byRepo.entries()).map(([name, repoFiles]) => ({ name, files: repoFiles }));
  return { repos, raw: diff };
}

/**
 * Resolve diff for a session. Handles both task-backed and standalone sessions.
 * - Task sessions: resolves workspace from the task's workspace_json
 * - Standalone sessions: resolves workspace from session meta_json (cwd provider)
 */
async function getSessionDiff(sessionId: string): Promise<string | null> {
  const session = db.getSession(sessionId);
  if (!session) return null;

  const meta = session.meta_json ? JSON.parse(session.meta_json) : {};

  // Task-backed session: resolve workspace from task
  if (session.task_id) {
    const task = db.getTask(session.task_id);
    if (!task) return null;
    const workspace = task.workspace_json
      ? JSON.parse(task.workspace_json)
      : { provider: 'git-worktree', config: {} };
    const provider = workspaceRegistry.get(workspace.provider);
    if (!provider?.getDiff) return null;
    return provider.getDiff({
      sessionId,
      agentType: session.agent_type ?? '',
      meta: { task_id: session.task_id, ...workspace.config },
    });
  }

  // Standalone session: resolve workspace from meta
  const providerName = meta.workspace?.provider ?? 'cwd';
  const config = meta.workspace?.config ?? {};
  const provider = workspaceRegistry.get(providerName);
  if (!provider?.getDiff) return null;
  return provider.getDiff({
    sessionId,
    agentType: session.agent_type ?? '',
    meta: { ...meta, ...config },
  });
}

// ─── Session-based diff endpoints ────────────────────────────────────────────

// GET /sessions/:id/diff
tasksRoutes.get('/sessions/:id/diff', async (c) => {
  const sessionId = c.req.param('id');
  const format = c.req.query('format') || 'unified';

  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const diff = await getSessionDiff(sessionId);
  if (!diff) return c.json(buildResponse(null));

  if (format === 'structured') {
    return c.json(buildResponse(diff));
  }
  return c.text(diff);
});

// GET /sessions/:id/diff/stream
tasksRoutes.get('/sessions/:id/diff/stream', async (c) => {
  const sessionId = c.req.param('id');

  const session = db.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendUpdate = async () => {
        try {
          const diff = await getSessionDiff(sessionId);
          const payload = JSON.stringify(buildResponse(diff));
          controller.enqueue(encoder.encode(`event: diff\ndata: ${payload}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${(err as Error).message}\n\n`));
        }
      };

      sendUpdate();

      const pollInterval = setInterval(async () => {
        const current = db.getSession(sessionId);
        if (!current || (current.state !== 'running' && current.state !== 'ready')) {
          clearInterval(pollInterval);
          // Send one final update then close
          await sendUpdate();
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

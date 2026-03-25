import { Hono } from 'hono';
import type { ExtensionContext, ExtensionExports, ExtensionModule } from '../../backend/src/lib/extensions/types.ts';
import { deriveTaskStatus } from '../../backend/src/lib/acp/task-status.ts';
import { db, generateTaskId } from '../../backend/src/db/client.ts';
import { getActiveSession, stopAgent } from '../../backend/src/lib/acp/index.ts';
import { archiveSessionsByTask } from '../../backend/src/db/sessions.ts';
import { gitManager } from '../../backend/src/lib/git.ts';
import { refreshTaskContext } from '../../backend/src/lib/context.ts';
import { sendError, validateTaskFields, validateRepoUrls, requireTask, VALID_TASK_STATUSES } from '../../backend/src/routes/shared.ts';
import type { AgentSessionState, CreateTaskBody, UpdateTaskBody } from '@agemon/shared';

/**
 * Tasks plugin — UI + task status derivation + task CRUD API routes.
 */
export const plugin: ExtensionModule = {
  onLoad(ctx: ExtensionContext): ExtensionExports {
    ctx.on('session:state_changed', (payload) => {
      const { taskId, state } = payload as { sessionId: string; taskId: string | null; state: AgentSessionState };
      if (taskId) deriveTaskStatus(taskId);
      ctx.logger.info(`session state → ${state}, derived task status for ${taskId}`);
    });

    const apiRoutes = new Hono();

    // ── Task CRUD ─────────────────────────────────────────────────────────────

    apiRoutes.get('/tasks', (c) => {
      const includeArchived = c.req.query('archived') === 'true';
      return c.json(db.listTasks(includeArchived));
    });

    apiRoutes.post('/tasks', async (c) => {
      let body: CreateTaskBody;
      try {
        body = await c.req.json<CreateTaskBody>();
      } catch {
        sendError(400, 'Request body must be valid JSON');
      }
      const { title: rawTitle, description, repos, agent } = body;
      const title = typeof rawTitle === 'string' ? rawTitle.trim() : rawTitle;

      if (!title || typeof title !== 'string') {
        sendError(400, 'title is required');
      }

      const repoUrls = repos ?? [];
      validateRepoUrls(repoUrls);

      const agentType = agent ?? 'claude-code';
      validateTaskFields({ title, description, agent: agentType });

      const task = db.createTask({
        id: generateTaskId(title),
        title,
        description: description ?? null,
        status: 'todo',
        agent: agentType,
        repos: repoUrls,
      });

      // Create worktrees + context for any repos attached at creation
      if (repoUrls.length > 0) {
        (async () => {
          for (const repo of task.repos) {
            try {
              await gitManager.createWorktree(task.id, repo.url);
            } catch (err) {
              console.warn(`[context] failed to create worktree for ${repo.name}:`, (err as Error).message);
            }
          }
          await refreshTaskContext(task);
        })().catch((err) => {
          console.warn(`[context] failed to set up context for task ${task.id}:`, err);
        });
      }

      ctx.broadcast({ type: 'task_updated', task });
      ctx.emit('task:created', task).catch(() => {});
      return c.json(task, 201);
    });

    // IMPORTANT: /tasks/by-project MUST be before /tasks/:id to avoid Hono matching "by-project" as an :id
    apiRoutes.get('/tasks/by-project', (c) => {
      const includeArchived = c.req.query('archived') === 'true';
      return c.json(db.listTasksByProject(includeArchived));
    });

    apiRoutes.get('/tasks/:id', (c) => {
      const task = requireTask(c.req.param('id'));
      return c.json(task);
    });

    apiRoutes.patch('/tasks/:id', async (c) => {
      const task = requireTask(c.req.param('id'));

      let body: UpdateTaskBody;
      try {
        body = await c.req.json<UpdateTaskBody>();
      } catch {
        sendError(400, 'Request body must be valid JSON');
      }

      const { title, description, agent, repos, status, archived } = body;
      validateTaskFields({ title, description, agent });

      if (status !== undefined && !VALID_TASK_STATUSES.has(status)) {
        sendError(400, `status must be one of: ${[...VALID_TASK_STATUSES].join(', ')}`);
      }

      if (repos !== undefined) {
        validateRepoUrls(repos);
      }

      if (archived !== undefined && typeof archived !== 'boolean') {
        sendError(400, 'archived must be a boolean');
      }

      // Handle "mark done" — clean up worktrees
      if (status === 'done' && task.status !== 'done') {
        // Stop any active sessions first
        const active = getActiveSession(task.id);
        if (active) {
          try { stopAgent(active.id); } catch { /* already stopping */ }
        }
        // Clean up worktrees
        await gitManager.deleteTaskWorktrees(task.id).catch((err) => {
          console.warn(`[routes] failed to clean worktrees for task ${task.id}:`, err);
        });
      }

      const updated = db.updateTask(task.id, { title, description, agent, repos, status, archived });
      if (!updated) return c.json({ error: 'Not Found', message: 'Task not found', statusCode: 404 }, 404);

      // Cascade archive to sessions: stop active ones, then archive all
      if (archived === true) {
        const sessions = db.listSessions(task.id, true);
        for (const s of sessions) {
          if (s.state === 'running' || s.state === 'ready' || s.state === 'starting') {
            try { stopAgent(s.id); } catch { /* already stopping */ }
          }
        }
        archiveSessionsByTask(task.id, true);
      }

      // When repos change: create worktrees + refresh context (CLAUDE.md, symlinks)
      if (repos !== undefined) {
        (async () => {
          for (const repo of updated.repos) {
            try {
              await gitManager.createWorktree(updated.id, repo.url);
            } catch (err) {
              console.warn(`[context] failed to create worktree for ${repo.name}:`, (err as Error).message);
            }
          }
          await refreshTaskContext(updated);
        })().catch((err) => {
          console.warn(`[context] failed to refresh context for task ${updated.id}:`, err);
        });
      }

      ctx.broadcast({ type: 'task_updated', task: updated });
      ctx.emit('task:updated', updated).catch(() => {});
      return c.json(updated);
    });

    apiRoutes.delete('/tasks/:id', (c) => {
      const id = c.req.param('id');
      const task = db.getTask(id);
      if (!task) sendError(404, 'Task not found');

      // Stop any running agent before deleting
      const active = getActiveSession(id);
      if (active) {
        try { stopAgent(active.id); } catch { /* already stopping */ }
      }

      db.deleteTask(id);
      ctx.broadcast({ type: 'task_updated', task: { ...task!, status: 'done' } });
      ctx.emit('task:deleted', { id, task }).catch(() => {});
      return new Response(null, { status: 204 });
    });

    apiRoutes.get('/tasks/:id/events', (c) => {
      const task = requireTask(c.req.param('id'));
      const limitParam = parseInt(c.req.query('limit') ?? '500', 10);
      const limit = isNaN(limitParam) || limitParam < 1 || limitParam > 1000 ? 500 : limitParam;
      const before = c.req.query('before') || undefined;
      const events = db.listEvents(task.id, limit, before);
      return c.json(events);
    });

    return {
      apiRoutes,
      pages: [{ path: '/', component: 'page' }],
    };
  },
};

export default plugin;

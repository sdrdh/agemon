import { Hono } from 'hono';
import type { ExtensionContext, ExtensionExports, ExtensionModule } from '../../backend/src/lib/extensions/types.ts';

/**
 * OpenClaw Integration extension.
 *
 * Two responsibilities:
 * 1. Forward Agemon events (task/session lifecycle) to an OpenClaw webhook
 * 2. Expose API routes for OpenClaw to configure notification mappings
 *
 * Also declares a bundled OpenClaw skill (skills/agemon/) that teaches
 * OpenClaw agents how to call the Agemon API directly.
 */

interface ChannelMapping {
  channel: string;
  createdAt: string;
}

export const plugin: ExtensionModule = {
  onLoad(ctx: ExtensionContext): ExtensionExports {
    const api = new Hono();

    // ── Helpers ──────────────────────────────────────────────────────────────

    function getWebhookUrl(): string | null {
      return ctx.getSetting('OPENCLAW_WEBHOOK_URL');
    }

    function getWebhookToken(): string | null {
      return ctx.getSetting('OPENCLAW_WEBHOOK_TOKEN');
    }

    function getMappingIndex(): string[] {
      return ctx.store.getJson<string[]>('mapping-index') ?? [];
    }

    function setMappingIndex(index: string[]): void {
      ctx.store.setJson('mapping-index', index);
    }

    /**
     * Forward an event to the configured OpenClaw webhook.
     * Only sends if webhook is configured AND a channel mapping exists for the task.
     */
    async function notify(event: string, payload: unknown): Promise<void> {
      const webhookUrl = getWebhookUrl();
      const webhookToken = getWebhookToken();
      if (!webhookUrl) return;

      const p = payload as Record<string, unknown>;
      const taskId = (p?.id ?? p?.taskId ?? p?.task_id) as string | undefined;
      if (!taskId) {
        ctx.logger.warn(`notify(${event}): no taskId in payload, skipping`);
        return;
      }

      const mapping = ctx.store.getJson<ChannelMapping>(`mapping:${taskId}`);
      if (!mapping) return; // no channel registered for this task

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (webhookToken) {
        headers['Authorization'] = `Bearer ${webhookToken}`;
      }

      try {
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            event,
            taskId,
            channel: mapping.channel,
            payload: p,
            timestamp: new Date().toISOString(),
          }),
        });
        if (!resp.ok) {
          ctx.logger.warn(`notify(${event}): webhook returned ${resp.status}`);
        }
      } catch (err) {
        ctx.logger.warn(`notify(${event}): failed:`, (err as Error).message);
      }
    }

    // ── Event Listeners ─────────────────────────────────────────────────────

    ctx.on('task:created', (p) => notify('task:created', p));
    ctx.on('task:updated', (p) => notify('task:updated', p));
    ctx.on('task:deleted', (p) => notify('task:deleted', p));
    ctx.on('session:state_changed', (p) => notify('session:state_changed', p));

    ctx.logger.info('event listeners registered');

    // ── API Routes ──────────────────────────────────────────────────────────

    /**
     * POST /configure — register a task for notifications on a channel.
     * Body: { taskId: string, channel: string }
     */
    api.post('/configure', async (c) => {
      const { taskId, channel } = await c.req.json<{ taskId: string; channel: string }>();
      if (!taskId || !channel) {
        return c.json({ error: 'taskId and channel are required' }, 400);
      }

      const mapping: ChannelMapping = {
        channel,
        createdAt: new Date().toISOString(),
      };
      ctx.store.setJson(`mapping:${taskId}`, mapping);

      // Maintain index
      const index = getMappingIndex();
      if (!index.includes(taskId)) {
        index.push(taskId);
        setMappingIndex(index);
      }

      ctx.logger.info(`configured notifications for task ${taskId} → ${channel}`);
      return c.json({ ok: true, taskId, channel });
    });

    /**
     * GET /mappings — list all notification mappings.
     */
    api.get('/mappings', (c) => {
      const index = getMappingIndex();
      const mappings = index
        .map((id) => {
          const m = ctx.store.getJson<ChannelMapping>(`mapping:${id}`);
          return m ? { taskId: id, ...m } : null;
        })
        .filter(Boolean);
      return c.json(mappings);
    });

    /**
     * DELETE /mappings/:taskId — remove a notification mapping.
     */
    api.delete('/mappings/:taskId', (c) => {
      const taskId = c.req.param('taskId');
      ctx.store.delete(`mapping:${taskId}`);

      const index = getMappingIndex().filter((id) => id !== taskId);
      setMappingIndex(index);

      ctx.logger.info(`removed notification mapping for task ${taskId}`);
      return c.json({ ok: true });
    });

    /**
     * GET /status — check webhook configuration status.
     */
    api.get('/status', (c) => {
      const webhookUrl = getWebhookUrl();
      return c.json({
        configured: !!webhookUrl,
        webhookUrl: webhookUrl ? '(set)' : null,
        mappingCount: getMappingIndex().length,
      });
    });

    return { apiRoutes: api };
  },
};

export default plugin;

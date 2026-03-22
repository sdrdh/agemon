import type { PluginContext, PluginExports, PluginModule } from '../../backend/src/lib/plugins/types.ts';
import { deriveTaskStatus } from '../../backend/src/lib/acp/task-status.ts';
import type { AgentSessionState } from '@agemon/shared';

/**
 * Tasks plugin — UI + task status derivation.
 *
 * All task CRUD and session management is handled by the core backend routes
 * (/api/tasks/*, /tasks/:id/sessions). The plugin frontend (page.tsx) calls
 * those routes directly.
 *
 * The plugin hooks into session state changes to keep task status derived.
 * TODO: replace direct deriveTaskStatus call with an emitted core event once
 * the ACP layer is refactored to use EventBridge throughout.
 */
export const plugin: PluginModule = {
  onLoad(ctx: PluginContext): PluginExports {
    ctx.on('session:state_changed', (payload) => {
      const { taskId, state } = payload as { sessionId: string; taskId: string | null; state: AgentSessionState };
      if (taskId) deriveTaskStatus(taskId);
      ctx.logger.info(`session state → ${state}, derived task status for ${taskId}`);
    });

    return {
      pages: [{ path: '/', component: 'page' }],
    };
  },
};

export default plugin;

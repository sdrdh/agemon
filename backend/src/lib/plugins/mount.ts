import type { Hono } from 'hono';
import type { LoadedPlugin } from './types.ts';
import { getPlugin, getPlugins } from './registry.ts';

/**
 * Mount plugin routes onto the main Hono app using dynamic dispatch.
 * A single catch-all middleware checks the live registry at request time,
 * so plugins hot-loaded after startup are picked up automatically.
 */
export function mountPluginRoutes(app: Hono, _plugins: LoadedPlugin[]): void {
  // Dynamic API dispatch — strips /api/plugins/:pluginId prefix and forwards
  app.all('/api/plugins/:pluginId/*', async (c) => {
    const pluginId = c.req.param('pluginId');
    const plugin = getPlugin(pluginId);
    if (!plugin?.exports.apiRoutes) return c.notFound();

    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(`/api/plugins/${pluginId}`.length) || '/';
    return plugin.exports.apiRoutes.fetch(new Request(url.toString(), c.req.raw));
  });

  // GET /api/plugins — list all loaded plugins
  app.get('/api/plugins', (c) => {
    const plugins = getPlugins();
    return c.json(plugins.map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      hasPages: p.manifest.hasPages ?? false,
      navLabel: p.manifest.navLabel ?? null,
      navIcon: p.manifest.navIcon ?? null,
    })));
  });
}

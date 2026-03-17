import type { Hono } from 'hono';
import type { LoadedPlugin } from './types.ts';
import { getPlugins } from './registry.ts';

/**
 * Mount all plugin routes onto the main Hono app.
 * - API routes at /api/plugins/{id}/  (auth covered by existing /api/* middleware)
 * - Page routes at /p/{id}/           (auth covered by main cookie/bearer middleware)
 */
export function mountPluginRoutes(app: Hono, plugins: LoadedPlugin[]): void {
  for (const plugin of plugins) {
    const { manifest, exports } = plugin;

    if (exports.apiRoutes) {
      app.route(`/api/plugins/${manifest.id}`, exports.apiRoutes);
    }

    if (exports.pageRoutes && manifest.hasPages) {
      app.route(`/p/${manifest.id}`, exports.pageRoutes);
    }
  }

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

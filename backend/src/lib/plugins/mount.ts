import type { Hono } from 'hono';
import type { LoadedPlugin } from './types.ts';
import { getPlugin, getPlugins } from './registry.ts';
import { getSetting, setSetting } from '../../db/settings.ts';

/** Setting key for per-plugin nav visibility. Default is enabled (true). */
function navSettingKey(pluginId: string): string {
  return `plugin_nav_${pluginId}`;
}

export function isNavEnabled(pluginId: string): boolean {
  const val = getSetting(navSettingKey(pluginId));
  return val !== 'false';
}

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
    return c.json(plugins.map(p => {
      // Synthesize navItems from legacy fields for backward compatibility
      const navItems = p.manifest.navItems ?? (p.manifest.navLabel ? [{
        label: p.manifest.navLabel,
        lucideIcon: p.manifest.navLucideIcon ?? null,
        icon: p.manifest.navIcon ?? null,
        path: '/',
        order: p.manifest.navOrder ?? 999,
      }] : []);
      const navEnabled = navItems.length > 0 ? isNavEnabled(p.manifest.id) : false;
      return {
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        hasPages: p.manifest.hasPages ?? false,
        navItems,
        navEnabled,
        showInSettings: p.manifest.showInSettings ?? true,
        inputExtensions: p.manifest.inputExtensions ?? [],
        // Legacy fields (kept for older clients)
        navLabel: p.manifest.navLabel ?? null,
        navIcon: p.manifest.navIcon ?? null,
        navLucideIcon: p.manifest.navLucideIcon ?? null,
      };
    }));
  });

  // PATCH /api/plugins/:pluginId — update plugin config (nav visibility)
  app.patch('/api/plugins/:pluginId', async (c) => {
    const pluginId = c.req.param('pluginId');
    if (!getPlugin(pluginId)) return c.notFound();

    const body = await c.req.json<{ navEnabled?: boolean }>();
    if (typeof body.navEnabled === 'boolean') {
      setSetting(navSettingKey(pluginId), body.navEnabled ? 'true' : 'false');
    }
    return c.json({ ok: true });
  });
}

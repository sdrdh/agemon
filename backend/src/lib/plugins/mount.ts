import { readFileSync } from 'node:fs';
import { join } from 'path';
import type { Hono } from 'hono';
import type { LoadedPlugin } from './types.ts';
import { getPlugin, getPlugins } from './registry.ts';
import { getBuildError } from './builder.ts';
import { getSetting, setSetting } from '../../db/settings.ts';
import { atomicWriteJsonSync } from '../fs.ts';

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
function readSettingsFile(settingsPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function getPluginSettingValue(agemonDir: string, pluginId: string, key: string): string | null {
  const envKey = `AGEMON_PLUGIN_${pluginId.toUpperCase().replace(/-/g, '_')}_${key.toUpperCase()}`;
  if (process.env[envKey] != null) return process.env[envKey]!;
  const settingsPath = join(agemonDir, 'plugins', pluginId, 'data', 'settings.json');
  return readSettingsFile(settingsPath)[key] ?? null;
}

export function mountPluginRoutes(app: Hono, plugins: LoadedPlugin[], agemonDir: string): void {
  // GET /api/plugins/:pluginId/settings — return schema + masked values
  app.get('/api/plugins/:pluginId/settings', (c) => {
    const pluginId = c.req.param('pluginId');
    const plugin = getPlugin(pluginId);
    if (!plugin) return c.notFound();

    const schema = plugin.manifest.settings ?? [];
    const result = schema.map(s => {
      const raw = getPluginSettingValue(agemonDir, pluginId, s.key);
      const value = s.type === 'secret' ? (raw != null ? 'set' : null) : raw;
      return { ...s, value };
    });
    return c.json(result);
  });

  // POST /api/plugins/:pluginId/settings — write key-value pairs
  app.post('/api/plugins/:pluginId/settings', async (c) => {
    const pluginId = c.req.param('pluginId');
    const plugin = getPlugin(pluginId);
    if (!plugin) return c.notFound();

    const body = await c.req.json<Record<string, string>>();
    const settingsPath = join(agemonDir, 'plugins', pluginId, 'data', 'settings.json');
    const current = readSettingsFile(settingsPath);
    for (const [key, value] of Object.entries(body)) {
      current[key] = value;
    }
    atomicWriteJsonSync(settingsPath, current);
    return c.json({ ok: true });
  });

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
      const navItems = p.manifest.navItems ?? [];
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
        configured: p.configured,
        hasSettings: (p.manifest.settings?.length ?? 0) > 0,
        buildError: getBuildError(p.manifest.id),
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

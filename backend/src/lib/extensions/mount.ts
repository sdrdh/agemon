import { readFileSync } from 'node:fs';
import { join } from 'path';
import type { Hono } from 'hono';
import type { LoadedExtension } from './types.ts';
import { getExtension, getExtensions } from './registry.ts';
import { getBuildError } from './builder.ts';
import { getSetting, setSetting } from '../../db/settings.ts';
import { atomicWriteJsonSync } from '../fs.ts';

/** Setting key for per-extension nav visibility. Default is enabled (true). */
function navSettingKey(extensionId: string): string {
  return `extension_nav_${extensionId}`;
}

export function isNavEnabled(extensionId: string): boolean {
  const val = getSetting(navSettingKey(extensionId));
  return val !== 'false';
}

/**
 * Mount extension routes onto the main Hono app using dynamic dispatch.
 * A single catch-all middleware checks the live registry at request time,
 * so extensions hot-loaded after startup are picked up automatically.
 */
function readSettingsFile(settingsPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function getExtensionSettingValue(agemonDir: string, extensionId: string, key: string): string | null {
  const envKey = `AGEMON_EXTENSION_${extensionId.toUpperCase().replace(/-/g, '_')}_${key.toUpperCase()}`;
  if (process.env[envKey] != null) return process.env[envKey]!;
  const settingsPath = join(agemonDir, 'extension-data', extensionId, 'settings.json');
  return readSettingsFile(settingsPath)[key] ?? null;
}

export function mountExtensionRoutes(app: Hono, extensions: LoadedExtension[], agemonDir: string): void {
  // GET /api/extensions/:extensionId/settings — return schema + masked values
  app.get('/api/extensions/:extensionId/settings', (c) => {
    const extensionId = c.req.param('extensionId');
    const ext = getExtension(extensionId);
    if (!ext) return c.notFound();

    const schema = ext.manifest.settings ?? [];
    const result = schema.map(s => {
      const raw = getExtensionSettingValue(agemonDir, extensionId, s.key);
      const value = s.type === 'secret' ? (raw != null ? 'set' : null) : raw;
      return { ...s, value };
    });
    return c.json(result);
  });

  // POST /api/extensions/:extensionId/settings — write key-value pairs
  app.post('/api/extensions/:extensionId/settings', async (c) => {
    const extensionId = c.req.param('extensionId');
    const ext = getExtension(extensionId);
    if (!ext) return c.notFound();

    let body: Record<string, string>;
    try { body = await c.req.json<Record<string, string>>(); }
    catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const settingsPath = join(agemonDir, 'extension-data', extensionId, 'settings.json');
    const current = readSettingsFile(settingsPath);
    for (const [key, value] of Object.entries(body)) {
      current[key] = value;
    }
    atomicWriteJsonSync(settingsPath, current);
    return c.json({ ok: true });
  });

  // GET /api/extensions/:extensionId — single extension
  app.get('/api/extensions/:extensionId', (c) => {
    const extensionId = c.req.param('extensionId');
    const e = getExtension(extensionId);
    if (!e) return c.json({ error: 'not_found' }, 404);
    const navItems = e.manifest.navItems ?? [];
    return c.json({
      id: e.manifest.id,
      name: e.manifest.name,
      version: e.manifest.version,
      description: e.manifest.description,
      type: e.type,
      hasPages: e.manifest.hasPages ?? false,
      navItems,
      navEnabled: navItems.length > 0 ? isNavEnabled(e.manifest.id) : false,
      showInSettings: e.manifest.showInSettings ?? true,
      inputExtensions: e.manifest.inputExtensions ?? [],
      configured: e.configured,
      hasSettings: (e.manifest.settings?.length ?? 0) > 0,
      buildError: getBuildError(e.manifest.id),
    });
  });

  // PATCH /api/extensions/:extensionId — update nav visibility
  app.patch('/api/extensions/:extensionId', async (c) => {
    const extensionId = c.req.param('extensionId');
    if (!getExtension(extensionId)) return c.notFound();

    let body: { navEnabled?: boolean };
    try { body = await c.req.json<{ navEnabled?: boolean }>(); }
    catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (typeof body.navEnabled === 'boolean') {
      setSetting(navSettingKey(extensionId), body.navEnabled ? 'true' : 'false');
    }
    return c.json({ ok: true });
  });

  // Dynamic API dispatch for extension-provided routes
  app.all('/api/extensions/:extensionId/*', async (c) => {
    const extensionId = c.req.param('extensionId');
    const ext = getExtension(extensionId);
    if (!ext?.exports.apiRoutes) return c.notFound();

    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(`/api/extensions/${extensionId}`.length) || '/';
    return ext.exports.apiRoutes.fetch(new Request(url.toString(), c.req.raw));
  });

  // GET /api/extensions — list all loaded extensions
  app.get('/api/extensions', (c) => {
    const exts = getExtensions();
    return c.json(exts.map(e => {
      const navItems = e.manifest.navItems ?? [];
      return {
        id: e.manifest.id,
        name: e.manifest.name,
        version: e.manifest.version,
        description: e.manifest.description,
        type: e.type,
        hasPages: e.manifest.hasPages ?? false,
        navItems,
        navEnabled: navItems.length > 0 ? isNavEnabled(e.manifest.id) : false,
        showInSettings: e.manifest.showInSettings ?? true,
        inputExtensions: e.manifest.inputExtensions ?? [],
        configured: e.configured,
        hasSettings: (e.manifest.settings?.length ?? 0) > 0,
        buildError: getBuildError(e.manifest.id),
      };
    }));
  });

}


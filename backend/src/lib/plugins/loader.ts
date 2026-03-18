import { readdir, symlink, lstat, stat } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../../db/client.ts';
import { getSetting } from '../../db/settings.ts';
import type { PluginManifest } from '@agemon/shared';
import type { LoadedPlugin, PluginContext, PluginExports } from './types.ts';

/**
 * Symlink a plugin's declared skills into ~/.agemon/skills/ so agents discover them.
 * Each skill becomes ~/.agemon/skills/{pluginId}--{skillName} → {pluginDir}/skills/{skillName}
 */
async function wirePluginSkills(manifest: { id: string; skills?: string[] }, pluginDir: string, agemonDir: string): Promise<void> {
  if (!manifest.skills?.length) return;

  const agemonSkillsDir = join(agemonDir, 'skills');

  for (const skillName of manifest.skills) {
    const skillSrc = join(pluginDir, 'skills', skillName);

    try {
      const s = await stat(skillSrc);
      if (!s.isDirectory()) {
        console.warn(`[plugin:${manifest.id}] skill "${skillName}" is not a directory, skipping (expected directory at ${skillSrc})`);
        continue;
      }
    } catch {
      console.warn(`[plugin:${manifest.id}] skill "${skillName}" not found at ${skillSrc}, skipping`);
      continue;
    }

    const linkName = `${manifest.id}--${skillName}`;
    const linkPath = join(agemonSkillsDir, linkName);

    try {
      await lstat(linkPath);
      // Already wired — skip
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        try {
          await symlink(skillSrc, linkPath);
          console.info(`[plugin:${manifest.id}] wired skill: ${skillName}`);
        } catch (symlinkErr) {
          console.warn(`[plugin:${manifest.id}] could not wire skill "${skillName}":`, (symlinkErr as Error).message);
        }
      }
    }
  }
}

/**
 * Scan ~/.agemon/plugins/ for plugin directories containing agemon-plugin.json.
 * For each valid plugin, optionally import its entryPoint and call onLoad().
 * Returns all successfully loaded plugins. Errors are logged, not thrown.
 */
export async function scanPlugins(agemonDir: string): Promise<LoadedPlugin[]> {
  const pluginsDir = join(agemonDir, 'plugins');
  const loaded: LoadedPlugin[] = [];

  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    return loaded;
  }

  for (const entry of entries) {
    const dir = join(pluginsDir, entry);
    const manifestPath = join(dir, 'agemon-plugin.json');

    try {
      const file = Bun.file(manifestPath);
      if (!await file.exists()) continue;

      const manifest = await file.json() as PluginManifest;

      // Basic validation
      if (!manifest.id || !manifest.name || !manifest.version) {
        console.warn(`[plugin:${entry}] invalid manifest — missing id, name, or version`);
        continue;
      }

      let exports: PluginExports = {};

      if (manifest.entryPoint) {
        const entryPath = join(dir, manifest.entryPoint);
        const mod = await import(entryPath);
        const onLoad = mod.onLoad ?? mod.default?.onLoad;

        if (typeof onLoad !== 'function') {
          console.warn(`[plugin:${manifest.id}] entryPoint does not export onLoad()`);
          continue;
        }

        const ctx: PluginContext = {
          agemonDir,
          pluginDir: dir,
          db: getDb(),
          getSetting,
          logger: {
            info: (...args: unknown[]) => console.info(`[plugin:${manifest.id}]`, ...args),
            warn: (...args: unknown[]) => console.warn(`[plugin:${manifest.id}]`, ...args),
            error: (...args: unknown[]) => console.error(`[plugin:${manifest.id}]`, ...args),
          },
        };

        exports = await onLoad(ctx);
      }

      await wirePluginSkills(manifest, dir, agemonDir);
      loaded.push({ manifest, dir, exports });
      console.info(`[plugin:${manifest.id}] loaded (v${manifest.version})`);
    } catch (err) {
      console.error(`[plugin:${entry}] failed to load:`, (err as Error).message);
    }
  }

  return loaded;
}

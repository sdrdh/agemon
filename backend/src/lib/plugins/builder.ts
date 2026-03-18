import { join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { watch } from 'fs';
import { createHash } from 'crypto';
import type { LoadedPlugin } from './types.ts';
import type { ServerEventPayload } from '@agemon/shared';

// ─── In-memory cache of built renderer/page modules ─────────────────────────

interface BuiltModule {
  code: string;
  hash: string;
}

// key: messageType for renderers, "pluginId:component" for pages, pluginId for icons
const builtRenderers = new Map<string, BuiltModule>();
const builtPages = new Map<string, BuiltModule>();
const builtIcons = new Map<string, BuiltModule>();

// Plugins currently being rebuilt — prevents concurrent rebuilds for the same plugin
const rebuildingPlugins = new Set<string>();

// Max allowed size for a built renderer/page JS file (2MB)
const MAX_MODULE_SIZE = 2 * 1024 * 1024;

export function getBuiltRenderer(messageType: string): BuiltModule | undefined {
  return builtRenderers.get(messageType);
}

export function getBuiltPage(pluginId: string, component: string): BuiltModule | undefined {
  return builtPages.get(`${pluginId}:${component}`);
}

export function getBuiltIcon(pluginId: string): BuiltModule | undefined {
  return builtIcons.get(pluginId);
}

// ─── Plugin Build ────────────────────────────────────────────────────────────

/**
 * Run `bun install` + `bun run build` in a plugin directory.
 * Returns true if build succeeded.
 */
async function runPluginBuild(pluginDir: string, pluginId: string): Promise<boolean> {
  // Check if package.json exists with a build script
  const pkgPath = join(pluginDir, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    if (!pkg.scripts?.build) {
      console.info(`[plugin:${pluginId}] no build script, skipping build`);
      return false;
    }
  } catch {
    console.info(`[plugin:${pluginId}] no package.json, skipping build`);
    return false;
  }

  // bun install
  console.info(`[plugin:${pluginId}] running bun install...`);
  const install = Bun.spawn(['bun', 'install'], {
    cwd: pluginDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const installExit = await install.exited;
  if (installExit !== 0) {
    const stderr = await new Response(install.stderr).text();
    console.error(`[plugin:${pluginId}] bun install failed:`, stderr);
    return false;
  }

  // bun run build
  console.info(`[plugin:${pluginId}] running bun run build...`);
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: pluginDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const buildExit = await build.exited;
  if (buildExit !== 0) {
    const stderr = await new Response(build.stderr).text();
    console.error(`[plugin:${pluginId}] build failed:`, stderr);
    return false;
  }

  console.info(`[plugin:${pluginId}] build complete`);
  return true;
}

/**
 * Load built JS files from plugin's dist/renderers/ into memory.
 */
async function loadBuiltFiles(pluginDir: string, pluginId: string): Promise<Map<string, BuiltModule>> {
  const distDir = join(pluginDir, 'dist', 'renderers');
  const modules = new Map<string, BuiltModule>();

  let files: string[];
  try {
    files = await readdir(distDir);
  } catch {
    return modules;
  }

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const name = file.replace(/\.js$/, '');
    try {
      const filePath = join(distDir, file);
      const code = await readFile(filePath, 'utf-8');
      if (Buffer.byteLength(code, 'utf-8') > MAX_MODULE_SIZE) {
        console.warn(`[plugin:${pluginId}] ${file} (${Buffer.byteLength(code, 'utf-8')} bytes) exceeds 2MB size limit, skipping`);
        continue;
      }
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
      modules.set(name, { code, hash });
    } catch (err) {
      console.error(`[plugin:${pluginId}] failed to read ${file}:`, (err as Error).message);
    }
  }

  return modules;
}

/**
 * Rebuild a single plugin and reload its modules into cache.
 * Skips if a rebuild is already in progress for this plugin.
 */
async function rebuildPlugin(plugin: LoadedPlugin): Promise<void> {
  const { exports, dir, manifest } = plugin;

  if (rebuildingPlugins.has(manifest.id)) {
    console.info(`[plugin:${manifest.id}] rebuild already in progress, skipping`);
    return;
  }
  rebuildingPlugins.add(manifest.id);

  try {
    const ok = await runPluginBuild(dir, manifest.id);
    if (!ok) return;

    const modules = await loadBuiltFiles(dir, manifest.id);

    // Clear stale entries for this plugin before re-populating
    if (exports.renderers) {
      for (const renderer of exports.renderers) {
        builtRenderers.delete(renderer.manifest.messageType);
      }
    }
    for (const key of builtPages.keys()) {
      if (key.startsWith(`${manifest.id}:`)) builtPages.delete(key);
    }
    builtIcons.delete(manifest.id);

    if (exports.renderers) {
      for (const renderer of exports.renderers) {
        const mod = modules.get(renderer.manifest.name);
        if (mod) builtRenderers.set(renderer.manifest.messageType, mod);
      }
    }
    if (exports.pages) {
      for (const page of exports.pages) {
        const mod = modules.get(page.component);
        if (mod) builtPages.set(`${manifest.id}:${page.component}`, mod);
      }
    }
    if (manifest.navIcon) {
      const mod = modules.get(manifest.navIcon);
      if (mod) builtIcons.set(manifest.id, mod);
    }

    console.info(`[plugin:${manifest.id}] hot reloaded`);
  } finally {
    rebuildingPlugins.delete(manifest.id);
  }
}

/**
 * Watch ~/.agemon/plugins/ for new plugin directories and hot-load them.
 * New plugins are scanned, built, added to the registry, and their renderers
 * watched — all without a server restart. Removed plugins are not unloaded
 * (Hono routes can't be unregistered; restart required for removal).
 */
export function watchPluginsDir(agemonDir: string, broadcast?: (event: ServerEventPayload) => void): void {
  const pluginsDir = join(agemonDir, 'plugins');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    watch(pluginsDir, { recursive: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const { scanPlugins } = await import('./loader.ts');
          const { getPlugins, setPlugins } = await import('./registry.ts');

          const existing = getPlugins();
          const existingIds = new Set(existing.map(p => p.manifest.id));

          const all = await scanPlugins(agemonDir);
          const newPlugins = all.filter(p => !existingIds.has(p.manifest.id));

          if (newPlugins.length === 0) return;

          setPlugins(all);

          for (const plugin of newPlugins) {
            await rebuildPlugin(plugin);
          }
          watchPlugins(newPlugins);

          console.info(`[plugins] hot-loaded: ${newPlugins.map(p => p.manifest.id).join(', ')}`);
          broadcast?.({ type: 'plugins_changed', pluginIds: newPlugins.map(p => p.manifest.id) });
        } catch (err) {
          console.error('[plugins] hot-load failed:', (err as Error).message);
        }
      }, 500);
    });
    console.info(`[plugins] watching ${pluginsDir} for new plugins`);
  } catch {
    console.warn('[plugins] could not watch plugins directory');
  }
}

/**
 * Watch each plugin's renderers/ directory for changes and rebuild on save.
 */
export function watchPlugins(plugins: LoadedPlugin[]): void {
  for (const plugin of plugins) {
    const { exports, dir, manifest } = plugin;
    if (!exports.renderers?.length && !exports.pages?.length) continue;

    const renderersDir = join(dir, 'renderers');
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      watch(renderersDir, { recursive: false }, (_event, filename) => {
        if (!filename?.endsWith('.tsx') && !filename?.endsWith('.ts')) return;
        // Debounce — wait for saves to settle before rebuilding
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.info(`[plugin:${manifest.id}] change detected in ${filename}, rebuilding...`);
          rebuildPlugin(plugin).catch(err =>
            console.error(`[plugin:${manifest.id}] rebuild failed:`, err.message)
          );
        }, 300);
      });
      console.info(`[plugin:${manifest.id}] watching ${renderersDir}`);
    } catch {
      // renderers/ dir doesn't exist yet — skip watching
    }
  }
}

/**
 * Build all plugins that have renderers/pages, then cache the output.
 * Call this after scanPlugins() + setPlugins().
 */
export async function buildPluginRenderers(plugins: LoadedPlugin[]): Promise<void> {
  builtRenderers.clear();
  builtPages.clear();
  builtIcons.clear();

  for (const plugin of plugins) {
    const { exports, dir, manifest } = plugin;
    const hasRenderers = exports.renderers && exports.renderers.length > 0;
    const hasPages = exports.pages && exports.pages.length > 0;
    const hasIcon = !!manifest.navIcon;

    if (!hasRenderers && !hasPages && !hasIcon) continue;

    // Run the plugin's build
    const built = await runPluginBuild(dir, manifest.id);
    if (!built) continue;

    // Load built files
    const modules = await loadBuiltFiles(dir, manifest.id);

    // Map renderers
    if (exports.renderers) {
      for (const renderer of exports.renderers) {
        const mod = modules.get(renderer.manifest.name);
        if (mod) {
          builtRenderers.set(renderer.manifest.messageType, mod);
          console.info(`[plugin:${manifest.id}] cached renderer: ${renderer.manifest.name}`);
        } else {
          console.warn(`[plugin:${manifest.id}] renderer ${renderer.manifest.name} not found in dist/`);
        }
      }
    }

    // Map pages
    if (exports.pages) {
      for (const page of exports.pages) {
        const mod = modules.get(page.component);
        if (mod) {
          builtPages.set(`${manifest.id}:${page.component}`, mod);
          console.info(`[plugin:${manifest.id}] cached page: ${page.component}`);
        } else {
          console.warn(`[plugin:${manifest.id}] page ${page.component} not found in dist/`);
        }
      }
    }

    // Map icon
    if (manifest.navIcon) {
      const mod = modules.get(manifest.navIcon);
      if (mod) {
        builtIcons.set(manifest.id, mod);
        console.info(`[plugin:${manifest.id}] cached icon: ${manifest.navIcon}`);
      } else {
        console.warn(`[plugin:${manifest.id}] icon ${manifest.navIcon} not found in dist/`);
      }
    }
  }
}

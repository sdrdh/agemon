import { join } from 'path';
import { readdir, readFile, access } from 'fs/promises';
import { watch, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import type { LoadedExtension } from './types.ts';
import type { EventBridge } from './event-bridge.ts';
import type { ServerEventPayload } from '@agemon/shared';
import { unwireAgentPlugins } from './wire-agent-plugins.ts';

// ─── In-memory cache of built renderer/page modules ─────────────────────────

interface BuiltModule {
  code: string;
  hash: string;
}

// key: messageType for renderers, "extensionId:component" for pages, extensionId for icons
const builtRenderers = new Map<string, BuiltModule>();
const builtPages = new Map<string, BuiltModule>();
const builtIcons = new Map<string, BuiltModule>();

// Extensions currently being rebuilt — prevents concurrent rebuilds for the same extension
const rebuildingExtensions = new Set<string>();

// Max allowed size for a built renderer/page JS file (2MB)
const MAX_MODULE_SIZE = 2 * 1024 * 1024;

// Last build error per extension (null = build succeeded or not yet built)
const buildErrors = new Map<string, string>();

export function getBuiltRenderer(messageType: string): BuiltModule | undefined {
  return builtRenderers.get(messageType);
}

export function getBuiltPage(pluginId: string, component: string): BuiltModule | undefined {
  return builtPages.get(`${pluginId}:${component}`);
}

export function getBuiltIcon(pluginId: string): BuiltModule | undefined {
  return builtIcons.get(pluginId);
}

export function getBuildError(pluginId: string): string | null {
  return buildErrors.get(pluginId) ?? null;
}

// ─── Extension Build ──────────────────────────────────────────────────────────

/**
 * Run `bun install` + `bun run build` in an extension directory.
 * Returns true if build succeeded.
 */
async function runExtensionBuild(pluginDir: string, pluginId: string): Promise<boolean> {
  // Check if package.json exists with a build script
  const pkgPath = join(pluginDir, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    if (!pkg.scripts?.build) {
      console.info(`[extension:${pluginId}] no build script, skipping build`);
      return false;
    }
  } catch {
    console.info(`[extension:${pluginId}] no package.json, skipping build`);
    return false;
  }

  // bun install (patch workspace deps temporarily for out-of-monorepo extensions)
  console.info(`[extension:${pluginId}] running bun install...`);
  const { patchWorkspaceDeps } = await import('./loader.ts');
  const originalPkg = patchWorkspaceDeps(pluginDir);
  const install = Bun.spawn(['bun', 'install'], {
    cwd: pluginDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const installExit = await install.exited;
  if (originalPkg) {
    writeFileSync(pkgPath, originalPkg);
  }
  if (installExit !== 0) {
    const stderr = await new Response(install.stderr).text();
    console.error(`[extension:${pluginId}] bun install failed:`, stderr);
    return false;
  }

  // bun run build
  console.info(`[extension:${pluginId}] running bun run build...`);
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: pluginDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const buildExit = await build.exited;
  if (buildExit !== 0) {
    const stderr = await new Response(build.stderr).text();
    console.error(`[extension:${pluginId}] build failed:`, stderr);
    buildErrors.set(pluginId, stderr.trim() || 'Build failed');
    return false;
  }

  buildErrors.delete(pluginId);
  console.info(`[extension:${pluginId}] build complete`);
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
        console.warn(`[extension:${pluginId}] ${file} (${Buffer.byteLength(code, 'utf-8')} bytes) exceeds 2MB size limit, skipping`);
        continue;
      }
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
      modules.set(name, { code, hash });
    } catch (err) {
      console.error(`[extension:${pluginId}] failed to read ${file}:`, (err as Error).message);
    }
  }

  return modules;
}

/**
 * Rebuild a single extension and reload its modules into cache.
 * Skips if a rebuild is already in progress for this extension.
 */
async function rebuildExtension(extension: LoadedExtension): Promise<void> {
  const { exports, dir, manifest } = extension;

  if (rebuildingExtensions.has(manifest.id)) {
    console.info(`[extension:${manifest.id}] rebuild already in progress, skipping`);
    return;
  }
  rebuildingExtensions.add(manifest.id);

  try {
    // Give plugin a chance to clean up before its code is replaced
    if (typeof exports.onUnload === 'function') {
      try { await exports.onUnload(); } catch (e) {
        console.warn(`[extension:${manifest.id}] onUnload error:`, (e as Error).message);
      }
    }
    await unwireAgentPlugins(manifest);  // Clean up old agent plugin symlinks

    const ok = await runExtensionBuild(dir, manifest.id);
    if (!ok) return;

    const modules = await loadBuiltFiles(dir, manifest.id);

    // Clear stale entries for this extension before re-populating
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
    if (manifest.inputExtensions) {
      for (const ext of manifest.inputExtensions) {
        const mod = modules.get(ext.component);
        if (mod) builtPages.set(`${manifest.id}:${ext.component}`, mod);
      }
    }
    const iconComponent = manifest.navItems?.find(ni => ni.icon)?.icon;
    if (iconComponent) {
      const mod = modules.get(iconComponent);
      if (mod) builtIcons.set(manifest.id, mod);
    }
    console.info(`[extension:${manifest.id}] hot reloaded`);
  } finally {
    rebuildingExtensions.delete(manifest.id);
  }
}

/**
 * Watch an extensions directory with a single recursive watcher.
 * Handles: new manifests (hot-load), manifest changes (re-wire), manifest deletion
 * (unload to draft), renderer changes (rebuild), skills/agent-plugins changes (re-wire).
 *
 * Ignores: .git/, node_modules/, dist/
 */
export function watchExtensionsDir(
  extensionsDir: string,
  agemonDir: string,
  broadcast?: (event: ServerEventPayload) => void,
  bridge?: EventBridge,
): void {
  // NOTE: `timers` and the fs.watch handle are not cleaned up on graceful shutdown.
  // Pending debounce callbacks may fire during shutdown; each callback has its own try/catch.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function debounce(key: string, ms: number, fn: () => Promise<void>): void {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      fn().catch(err => console.error('[extensions] debounce error:', (err as Error).message));
    }, ms));
  }

  try {
    watch(extensionsDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      // Parse: first segment = extensionId, rest = relative path within extension
      const parts = filename.split('/');
      const extensionId = parts[0];
      const innerPath = parts.slice(1).join('/');

      if (!extensionId) return;

      // Ignore noise paths
      if (innerPath.startsWith('.git/') ||
          innerPath.startsWith('node_modules/') ||
          innerPath.startsWith('dist/')) return;

      // Manifest created, changed, or deleted
      if (innerPath === 'agemon-extension.json') {
        debounce(`manifest:${extensionId}`, 500, async () => {
          const manifestPath = join(extensionsDir, extensionId, 'agemon-extension.json');
          const exists = await access(manifestPath).then(() => true).catch(() => false);

          if (exists) {
            await hotLoadExtension(extensionId, extensionsDir, agemonDir, bridge, broadcast);
          } else {
            await unloadExtension(extensionId, agemonDir, broadcast);
          }
        });
        return;
      }

      // Renderer change → rebuild
      if (innerPath.startsWith('renderers/') && (innerPath.endsWith('.ts') || innerPath.endsWith('.tsx'))) {
        debounce(`rebuild:${extensionId}`, 300, async () => {
          const { getExtension } = await import('./registry.ts');
          const ext = getExtension(extensionId);
          if (ext) {
            await rebuildExtension(ext);
            broadcast?.({ type: 'extensions_changed', extensionIds: [extensionId] });
          }
        });
        return;
      }

      // Skills or agentPlugins changed → re-wire
      if (innerPath.startsWith('skills/') || innerPath.startsWith('agent-plugins/')) {
        debounce(`wire:${extensionId}`, 500, async () => {
          const { getExtension } = await import('./registry.ts');
          const ext = getExtension(extensionId);
          if (ext) {
            const { wireExtensionSkills } = await import('./loader.ts');
            const { wireAgentPlugins } = await import('./wire-agent-plugins.ts');
            await wireExtensionSkills(ext.manifest, ext.dir, agemonDir);
            await wireAgentPlugins(ext.manifest, ext.dir);
          }
        });
      }
    });

    console.info(`[extensions] watching ${extensionsDir}`);
  } catch {
    console.warn(`[extensions] could not watch ${extensionsDir}`);
  }
}

async function hotLoadExtension(
  extensionId: string,
  extensionsDir: string,
  agemonDir: string,
  bridge?: EventBridge,
  broadcast?: (event: ServerEventPayload) => void,
): Promise<void> {
  try {
    const { scanExtensions } = await import('./loader.ts');
    const { getExtensions, setExtensions } = await import('./registry.ts');

    if (!bridge) {
      console.warn('[extensions] hot-load skipped: no EventBridge');
      return;
    }

    // We rescan all extensions (not just this one) to get a complete registry picture.
    // This ensures bundled extensions are preserved in the merge below.
    // Trade-off: slightly more work than a single-extension scan, acceptable for hot-reload frequency.
    const freshAll = await scanExtensions(agemonDir, bridge);
    const freshExt = freshAll.find(e => e.manifest.id === extensionId);

    if (!freshExt) {
      console.warn(`[extensions] hot-load: ${extensionId} not found after rescan`);
      return;
    }

    // Merge: keep all other extensions, replace/add this one
    const existing = getExtensions().filter(e => e.manifest.id !== extensionId);
    setExtensions([...existing, freshExt]);

    await rebuildExtension(freshExt);

    console.info(`[extensions] hot-loaded: ${extensionId}`);
    broadcast?.({ type: 'extensions_changed', extensionIds: [extensionId] });
  } catch (err) {
    console.error(`[extensions] hot-load failed for ${extensionId}:`, (err as Error).message);
  }
}

async function unloadExtension(
  extensionId: string,
  agemonDir: string,
  broadcast?: (event: ServerEventPayload) => void,
): Promise<void> {
  try {
    const { getExtension, setExtensions, getExtensions } = await import('./registry.ts');

    const ext = getExtension(extensionId);
    if (!ext) return;

    if (typeof ext.exports.onUnload === 'function') {
      try { await ext.exports.onUnload(); } catch (e) {
        console.warn(`[extension:${extensionId}] onUnload error:`, (e as Error).message);
      }
    }

    const { unwireExtensionSkills } = await import('./loader.ts');
    await unwireAgentPlugins(ext.manifest);
    await unwireExtensionSkills(ext.manifest, agemonDir);
    setExtensions(getExtensions().filter(e => e.manifest.id !== extensionId));
    clearExtensionBuiltModules(extensionId, ext);

    console.info(`[extension:${extensionId}] unloaded (reverted to draft)`);
    broadcast?.({ type: 'extensions_changed', extensionIds: [extensionId] });
  } catch (err) {
    console.error(`[extensions] unload failed for ${extensionId}:`, (err as Error).message);
  }
}

function clearExtensionBuiltModules(extensionId: string, ext: LoadedExtension): void {
  if (ext.exports.renderers) {
    for (const renderer of ext.exports.renderers) {
      builtRenderers.delete(renderer.manifest.messageType);
    }
  }
  for (const key of builtPages.keys()) {
    if (key.startsWith(`${extensionId}:`)) builtPages.delete(key);
  }
  builtIcons.delete(extensionId);
}

/**
 * Build all extensions that have renderers/pages, then cache the output.
 * Call this after scanExtensions() + setExtensions().
 */
export async function buildExtensionRenderers(extensions: LoadedExtension[]): Promise<void> {
  builtRenderers.clear();
  builtPages.clear();
  builtIcons.clear();

  for (const extension of extensions) {
    const { exports, dir, manifest } = extension;
    const hasRenderers = exports.renderers && exports.renderers.length > 0;
    const hasPages = exports.pages && exports.pages.length > 0;
    const hasIcon = manifest.navItems?.some(ni => ni.icon) ?? false;
    const hasInputExtensions = (manifest.inputExtensions?.length ?? 0) > 0;

    if (!hasRenderers && !hasPages && !hasIcon && !hasInputExtensions) continue;

    // Run the extension's build
    const built = await runExtensionBuild(dir, manifest.id);
    if (!built) continue;

    // Load built files
    const modules = await loadBuiltFiles(dir, manifest.id);

    // Map renderers
    if (exports.renderers) {
      for (const renderer of exports.renderers) {
        const mod = modules.get(renderer.manifest.name);
        if (mod) {
          builtRenderers.set(renderer.manifest.messageType, mod);
          console.info(`[extension:${manifest.id}] cached renderer: ${renderer.manifest.name}`);
        } else {
          console.warn(`[extension:${manifest.id}] renderer ${renderer.manifest.name} not found in dist/`);
        }
      }
    }

    // Map pages
    if (exports.pages) {
      for (const page of exports.pages) {
        const mod = modules.get(page.component);
        if (mod) {
          builtPages.set(`${manifest.id}:${page.component}`, mod);
          console.info(`[extension:${manifest.id}] cached page: ${page.component}`);
        } else {
          console.warn(`[extension:${manifest.id}] page ${page.component} not found in dist/`);
        }
      }
    }

    // Map input extension components into builtPages
    if (manifest.inputExtensions) {
      for (const ext of manifest.inputExtensions) {
        const mod = modules.get(ext.component);
        if (mod) {
          builtPages.set(`${manifest.id}:${ext.component}`, mod);
          console.info(`[extension:${manifest.id}] cached input extension: ${ext.component}`);
        } else {
          console.warn(`[extension:${manifest.id}] input extension ${ext.component} not found in dist/`);
        }
      }
    }

    // Map icon (first navItem with icon: "component-name" wins)
    const iconComponent = manifest.navItems?.find(ni => ni.icon)?.icon;
    if (iconComponent) {
      const mod = modules.get(iconComponent);
      if (mod) {
        builtIcons.set(manifest.id, mod);
        console.info(`[extension:${manifest.id}] cached icon: ${iconComponent}`);
      } else {
        console.warn(`[extension:${manifest.id}] icon ${iconComponent} not found in dist/`);
      }
    }
  }
}


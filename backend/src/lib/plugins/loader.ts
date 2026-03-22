import { readdir, symlink, lstat, stat, access } from 'fs/promises';
import { join } from 'path';
import { getSessionDb } from '../session-store.ts';
import { getSetting } from '../../db/settings.ts';
import { atomicWriteSync, ensureDir } from '../fs.ts';
import type { AgentSession, AgentType } from '@agemon/shared';
import type { PluginManifest } from '@agemon/shared';
import type { LoadedPlugin, PluginContext, PluginExports } from './types.ts';
import type { EventBridge } from './event-bridge.ts';
import { agentRegistry } from './agent-registry.ts';

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
 * Run `bun install` in a plugin directory if it has a package.json.
 */
async function ensureDepsInstalled(pluginDir: string, pluginId: string): Promise<void> {
  try {
    await access(join(pluginDir, 'package.json'));
  } catch {
    return; // no package.json, nothing to install
  }

  const proc = Bun.spawn(['bun', 'install'], {
    cwd: pluginDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const exit = await proc.exited;
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`bun install failed: ${stderr.trim()}`);
  }
}

export interface SessionApi {
  createSession(opts: { agentType: AgentType; meta: Record<string, unknown> }): AgentSession;
  spawnSession(sessionId: string): AgentSession;
}

export interface ScanPluginsOptions {
  /** Additional directories to scan for plugins (e.g. repo-bundled plugins). */
  extraDirs?: string[];
  /** Session API wired from server.ts — allows plugins to create and spawn sessions. */
  sessionApi?: SessionApi;
}

/**
 * Scan ~/.agemon/plugins/ (and optionally extra dirs) for plugin directories
 * containing agemon-plugin.json. For each valid plugin, optionally import its
 * entryPoint and call onLoad(). Returns all successfully loaded plugins.
 * Errors are logged, not thrown.
 */
export async function scanPlugins(
  agemonDir: string,
  bridge?: EventBridge,
  opts?: ScanPluginsOptions,
): Promise<LoadedPlugin[]> {
  const pluginsDir = join(agemonDir, 'plugins');
  const loaded: LoadedPlugin[] = [];
  const seenIds = new Set<string>();

  // Collect all directories to scan: ~/.agemon/plugins/ first, then extras
  const scanDirs = [pluginsDir, ...(opts?.extraDirs ?? [])];

  for (const scanDir of scanDirs) {
    let entries: string[];
    try {
      entries = await readdir(scanDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const dir = join(scanDir, entry);
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

        // Skip duplicates (first occurrence wins — user plugins override bundled)
        if (seenIds.has(manifest.id)) continue;
        seenIds.add(manifest.id);

        let exports: PluginExports = {};

        if (manifest.entryPoint) {
          await ensureDepsInstalled(dir, manifest.id);
          const entryPath = join(dir, manifest.entryPoint);
          const mod = await import(entryPath);
          const onLoad = mod.onLoad ?? mod.default?.onLoad;

          if (typeof onLoad !== 'function') {
            console.warn(`[plugin:${manifest.id}] entryPoint does not export onLoad()`);
            continue;
          }

          const pluginDataDir = join(agemonDir, 'plugins', manifest.id, 'data');
          ensureDir(pluginDataDir);

          const ctx: PluginContext = {
            agemonDir,
            pluginDir: dir,
            pluginDataDir,
            coreDb: getSessionDb(),
            atomicWrite: atomicWriteSync,
            getSetting,
            logger: {
              info: (...args: unknown[]) => console.info(`[plugin:${manifest.id}]`, ...args),
              warn: (...args: unknown[]) => console.warn(`[plugin:${manifest.id}]`, ...args),
              error: (...args: unknown[]) => console.error(`[plugin:${manifest.id}]`, ...args),
            },
            hook: bridge
              ? (event, handler, opts) => bridge.registerHook(manifest.id, event, handler, opts)
              : (_e, _h, _o) => { console.warn(`[plugin:${manifest.id}] hook() called but no EventBridge`); },
            on: bridge
              ? (event, handler) => bridge.registerListener(manifest.id, event, handler)
              : (_e, _h) => { console.warn(`[plugin:${manifest.id}] on() called but no EventBridge`); },
            emit: bridge
              ? (event, payload) => bridge.emit(event, payload)
              : async (_e, _p) => { console.warn(`[plugin:${manifest.id}] emit() called but no EventBridge`); },
            broadcast: bridge
              ? (wsEvent) => bridge.broadcast(wsEvent)
              : (_e) => { console.warn(`[plugin:${manifest.id}] broadcast() called but no EventBridge`); },
            createSession: opts?.sessionApi
              ? (args) => opts.sessionApi!.createSession(args)
              : (_args) => { throw new Error(`[plugin:${manifest.id}] createSession() called but no sessionApi`); },
            spawnSession: opts?.sessionApi
              ? (sessionId) => opts.sessionApi!.spawnSession(sessionId)
              : (_id) => { throw new Error(`[plugin:${manifest.id}] spawnSession() called but no sessionApi`); },
          };

          exports = await onLoad(ctx);

          if (exports.agentProviders) {
            for (const provider of exports.agentProviders) {
              agentRegistry.register(provider);
            }
          }
        }

        await wirePluginSkills(manifest, dir, agemonDir);
        loaded.push({ manifest, dir, exports });
        console.info(`[plugin:${manifest.id}] loaded (v${manifest.version})`);
      } catch (err) {
        console.error(`[plugin:${entry}] failed to load:`, (err as Error).message);
      }
    }
  }

  return loaded;
}

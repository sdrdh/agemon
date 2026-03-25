import { readdir, symlink, lstat, stat, access, mkdir, unlink } from 'fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { wireAgentPlugins } from './wire-agent-plugins.ts';
import { getSessionDb } from '../session-store.ts';
import { atomicWriteSync, atomicWriteJsonSync } from '../fs.ts';
import type { AgentSession, AgentType } from '@agemon/shared';
import type { ExtensionManifest } from '@agemon/shared';
import type { LoadedExtension, ExtensionContext, ExtensionExports, ExtensionStore } from './types.ts';
import type { EventBridge } from './event-bridge.ts';
import { agentRegistry } from './agent-registry.ts';
import { getExtension } from './registry.ts';
import { workspaceRegistry } from './workspace-registry.ts';

// ─── Per-extension settings helpers ──────────────────────────────────────────

function readExtensionSettings(settingsPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeExtensionSetting(settingsPath: string, key: string, value: string): void {
  const settings = readExtensionSettings(settingsPath);
  settings[key] = value;
  atomicWriteJsonSync(settingsPath, settings);
}

// ─── Per-extension KV store helpers ──────────────────────────────────────────

function makeExtensionStore(storePath: string): ExtensionStore {
  function readStore(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(storePath, 'utf-8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  return {
    get: (key) => readStore()[key] ?? null,
    set: (key, value) => { const s = readStore(); s[key] = value; atomicWriteJsonSync(storePath, s); },
    getJson: <T>(key: string): T | null => { const v = readStore()[key]; return v != null ? JSON.parse(v) as T : null; },
    setJson: (key, value) => { const s = readStore(); s[key] = JSON.stringify(value); atomicWriteJsonSync(storePath, s); },
    delete: (key) => { const s = readStore(); delete s[key]; atomicWriteJsonSync(storePath, s); },
  };
}

/**
 * Symlink an extension's declared skills into ~/.agemon/skills/ so agents discover them.
 * Each skill becomes ~/.agemon/skills/{extensionId}--{skillName} → {extensionDir}/skills/{skillName}
 */
export async function wireExtensionSkills(manifest: { id: string; skills?: string[] }, extensionDir: string, agemonDir: string): Promise<void> {
  if (!manifest.skills?.length) return;

  const agemonSkillsDir = join(agemonDir, 'skills');

  for (const skillName of manifest.skills) {
    const skillSrc = join(extensionDir, 'skills', skillName);

    try {
      const s = await stat(skillSrc);
      if (!s.isDirectory()) {
        console.warn(`[extension:${manifest.id}] skill "${skillName}" is not a directory, skipping (expected directory at ${skillSrc})`);
        continue;
      }
    } catch {
      console.warn(`[extension:${manifest.id}] skill "${skillName}" not found at ${skillSrc}, skipping`);
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
          console.info(`[extension:${manifest.id}] wired skill: ${skillName}`);
        } catch (symlinkErr) {
          console.warn(`[extension:${manifest.id}] could not wire skill "${skillName}":`, (symlinkErr as Error).message);
        }
      }
    }
  }
}

/**
 * Remove skill symlinks for an extension from ~/.agemon/skills/.
 * Called when an extension is unloaded so stale symlinks don't persist.
 */
export async function unwireExtensionSkills(manifest: ExtensionManifest, agemonDir: string): Promise<void> {
  if (!manifest.skills || manifest.skills.length === 0) return;

  const skillsDir = join(agemonDir, 'skills');
  for (const skillName of manifest.skills) {
    const linkName = `${manifest.id}--${skillName}`;
    const linkPath = join(skillsDir, linkName);
    try {
      await unlink(linkPath);
      console.info(`[extension:${manifest.id}] removed skill symlink: ${linkName}`);
    } catch {
      // Already gone or never existed — ignore
    }
  }
}

/** App root: four dirs up from backend/src/lib/extensions/ */
const APP_ROOT = join(import.meta.dir, '..', '..', '..', '..');

/** Lazily-built map of workspace package names → absolute paths. */
let _wsMap: Record<string, string> | null = null;
function workspaceMap(): Record<string, string> {
  if (_wsMap) return _wsMap;
  _wsMap = {};
  try {
    const rootPkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf-8'));
    for (const pattern of (rootPkg.workspaces ?? []) as string[]) {
      if (pattern.includes('*')) {
        const base = join(APP_ROOT, pattern.replace('/*', ''));
        try {
          for (const entry of require('fs').readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            try {
              const p = JSON.parse(readFileSync(join(base, entry.name, 'package.json'), 'utf-8'));
              if (p.name) _wsMap![p.name] = join(base, entry.name);
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      } else {
        try {
          const p = JSON.parse(readFileSync(join(APP_ROOT, pattern, 'package.json'), 'utf-8'));
          if (p.name) _wsMap![p.name] = join(APP_ROOT, pattern);
        } catch { /* skip */ }
      }
    }
  } catch { /* root package.json not readable */ }
  return _wsMap;
}

/**
 * Temporarily rewrite `workspace:*` deps in an extension's package.json to
 * `file:` paths pointing at the monorepo packages. This lets `bun install`
 * succeed for extensions outside the workspace (e.g. user extensions in
 * ~/.agemon/extensions/).  Returns the original content so the caller can
 * restore it after install.
 */
export function patchWorkspaceDeps(extensionDir: string): string | null {
  const pkgPath = join(extensionDir, 'package.json');
  const original = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(original);
  const wsPackages = workspaceMap();
  let modified = false;

  for (const depKey of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[depKey];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        const resolved = wsPackages[name];
        if (resolved) {
          deps[name] = `file:${resolved}`;
          modified = true;
        }
      }
    }
  }

  if (!modified) return null;
  require('fs').writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return original;
}

/**
 * Run `bun install` in an extension directory if it has a package.json.
 * Temporarily rewrites workspace:* deps to file: paths, then restores the
 * original package.json so git stays clean.
 */
async function ensureDepsInstalled(extensionDir: string, extensionId: string): Promise<void> {
  try {
    await access(join(extensionDir, 'package.json'));
  } catch {
    return; // no package.json, nothing to install
  }

  // Patch workspace deps for install, restore after
  const original = patchWorkspaceDeps(extensionDir);

  try {
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: extensionDir,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const exit = await proc.exited;
    if (exit !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`bun install failed: ${stderr.trim()}`);
    }
  } finally {
    // Always restore original package.json
    if (original) {
      require('fs').writeFileSync(join(extensionDir, 'package.json'), original);
    }
  }
}

export interface SessionApi {
  createSession(opts: { agentType: AgentType; meta: Record<string, unknown> }): AgentSession;
  spawnSession(sessionId: string): AgentSession;
}

export interface ScanExtensionsOptions {
  /** Additional directories to scan for extensions (e.g. repo-bundled extensions). */
  extraDirs?: string[];
  /** Session API wired from server.ts — allows extensions to create and spawn sessions. */
  sessionApi?: SessionApi;
}


/**
 * Scan ~/.agemon/extensions/ (and optionally extra dirs) for extension directories
 * containing agemon-extension.json. For each valid extension, optionally import its
 * entryPoint and call onLoad(). Returns all successfully loaded extensions.
 * Errors are logged, not thrown.
 */
/** Current extension API version. Extensions with a different apiVersion will log a warning. */
const PLUGIN_API_VERSION = 1;

/** Topologically sort extensions based on `depends` declarations. */
function topoSort<T extends { manifest: ExtensionManifest; dir: string }>(candidates: Array<T>): Array<T> {
  const byId = new Map(candidates.map(p => [p.manifest.id, p]));
  const sorted: Array<T> = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      console.warn(`[extensions] dependency cycle detected involving "${id}"`);
      return;
    }
    visiting.add(id);
    const ext = byId.get(id);
    if (!ext) return;
    for (const dep of ext.manifest.depends ?? []) {
      if (!byId.has(dep)) {
        console.warn(`[extension:${id}] declares dependency on "${dep}" which was not found`);
      }
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(ext);
  }

  for (const p of candidates) visit(p.manifest.id);
  return sorted;
}

export async function scanExtensions(
  agemonDir: string,
  bridge?: EventBridge,
  opts?: ScanExtensionsOptions,
): Promise<LoadedExtension[]> {
  const pluginsDir = join(agemonDir, 'extensions');
  const seenIds = new Set<string>();

  // ── Pass 1: Collect all valid manifests ──────────────────────────────────
  const candidates: Array<{ manifest: ExtensionManifest; dir: string; fromScanDir: string }> = [];
  const scanDirs = [pluginsDir, ...(opts?.extraDirs ?? [])];
  // Track which scan directories are "bundled" (provided via opts.extraDirs, e.g. repo plugins/)
  const bundledDirs = new Set(opts?.extraDirs ?? []);

  for (const scanDir of scanDirs) {
    let entries: string[];
    try {
      entries = await readdir(scanDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const dir = join(scanDir, entry);
      const manifestPath = join(dir, 'agemon-extension.json');

      try {
        const file = Bun.file(manifestPath);
        if (!await file.exists()) continue;

        const manifest = await file.json() as ExtensionManifest;

        if (!manifest.id || !manifest.name || !manifest.version) {
          console.warn(`[extension:${entry}] invalid manifest — missing id, name, or version`);
          continue;
        }

        // First occurrence wins — user extensions override bundled
        if (seenIds.has(manifest.id)) continue;
        seenIds.add(manifest.id);

        candidates.push({ manifest, dir, fromScanDir: scanDir });
      } catch (err) {
        console.error(`[extension:${entry}] failed to read manifest:`, (err as Error).message);
      }
    }
  }

  // ── Pass 2: Load in dependency order ─────────────────────────────────────
  const ordered = topoSort(candidates);
  const loaded: LoadedExtension[] = [];

  for (const { manifest, dir, fromScanDir } of ordered) {
    try {
      // API version check
      if (manifest.apiVersion != null && manifest.apiVersion !== PLUGIN_API_VERSION) {
        console.warn(`[extension:${manifest.id}] apiVersion mismatch — extension declares ${manifest.apiVersion}, host is ${PLUGIN_API_VERSION}`);
      }

      let exports: ExtensionExports = {};

      const extensionDataDir = join(agemonDir, 'extension-data', manifest.id);
      const extensionSettingsPath = join(extensionDataDir, 'settings.json');
      const extensionStorePath = join(extensionDataDir, 'store.json');
      const envPrefix = `AGEMON_EXTENSION_${manifest.id.toUpperCase().replace(/-/g, '_')}_`;
      const getExtensionSetting = (key: string): string | null => {
        const envKey = `${envPrefix}${key.toUpperCase()}`;
        return process.env[envKey] ?? readExtensionSettings(extensionSettingsPath)[key] ?? null;
      };

      if (manifest.entryPoint) {
        await ensureDepsInstalled(dir, manifest.id);
        const entryPath = join(dir, manifest.entryPoint);
        const mod = await import(entryPath);
        const onLoad = mod.onLoad ?? mod.default?.onLoad;

        if (typeof onLoad !== 'function') {
          console.warn(`[extension:${manifest.id}] entryPoint does not export onLoad()`);
          continue;
        }

        await mkdir(extensionDataDir, { recursive: true });

        const ctx: ExtensionContext = {
          agemonDir,
          extensionDir: dir,
          extensionDataDir,
          coreDb: getSessionDb(),
          atomicWrite: atomicWriteSync,
          getSetting: getExtensionSetting,
          setSetting: (key, value) => writeExtensionSetting(extensionSettingsPath, key, value),
          store: makeExtensionStore(extensionStorePath),
          logger: {
            info: (...args: unknown[]) => console.info(`[extension:${manifest.id}]`, ...args),
            warn: (...args: unknown[]) => console.warn(`[extension:${manifest.id}]`, ...args),
            error: (...args: unknown[]) => console.error(`[extension:${manifest.id}]`, ...args),
          },
          hook: bridge
            ? (event, handler, opts) => bridge.registerHook(manifest.id, event, handler, opts)
            : (_e, _h, _o) => { console.warn(`[extension:${manifest.id}] hook() called but no EventBridge`); },
          on: bridge
            ? (event, handler) => bridge.registerListener(manifest.id, event, handler)
            : (_e, _h) => { console.warn(`[extension:${manifest.id}] on() called but no EventBridge`); },
          emit: bridge
            ? (event, payload) => bridge.emit(event, payload)
            : async (_e, _p) => { console.warn(`[extension:${manifest.id}] emit() called but no EventBridge`); },
          broadcast: bridge
            ? (wsEvent) => bridge.broadcast(wsEvent)
            : (_e) => { console.warn(`[extension:${manifest.id}] broadcast() called but no EventBridge`); },
          createSession: opts?.sessionApi
            ? (args) => opts.sessionApi!.createSession(args)
            : (_args) => { throw new Error(`[extension:${manifest.id}] createSession() called but no sessionApi`); },
          spawnSession: opts?.sessionApi
            ? (sessionId) => opts.sessionApi!.spawnSession(sessionId)
            : (_id) => { throw new Error(`[extension:${manifest.id}] spawnSession() called but no sessionApi`); },
          // ctx.query safe: dependencies are loaded first (topological order)
          query: (targetExtensionId, name, ...args) => {
            const target = getExtension(targetExtensionId);
            const fn = target?.exports.queries?.[name];
            if (!fn) throw new Error(`[extension:${manifest.id}] query ${targetExtensionId}.${name} not found`);
            return fn(...args);
          },
          workspaces: workspaceRegistry,
        };

        exports = await onLoad(ctx);

        if (exports.agentProviders) {
          for (const provider of exports.agentProviders) {
            agentRegistry.register(provider);
          }
        }
      }

      await wireExtensionSkills(manifest, dir, agemonDir);
      await wireAgentPlugins(manifest, dir);

      const configured = !(manifest.settings ?? [])
        .filter(s => s.required)
        .some(s => getExtensionSetting(s.key) === null);

      // Detect extension type based on scan origin
      let extType: 'bundled' | 'installed' | 'local' = 'local';
      let finalManifest = manifest;
      if (bundledDirs.has(fromScanDir)) {
        finalManifest = { ...manifest, bundled: true };
        extType = 'bundled';
      } else {
        // Check for .git to distinguish installed (git-managed) from local
        try {
          await stat(join(dir, '.git'));
          extType = 'installed';
        } catch {
          extType = 'local';
        }
      }

      loaded.push({ manifest: finalManifest, dir, exports, configured, type: extType });
      console.info(`[extension:${manifest.id}] loaded (v${manifest.version})`);
    } catch (err) {
      console.error(`[extension:${manifest.id}] failed to load:`, (err as Error).message);
    }
  }

  return loaded;
}


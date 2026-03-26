import { Hono } from 'hono';
import { join } from 'path';
import { mkdir, rename, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import { AGEMON_DIR } from '../lib/git.ts';
import { getExtension, getExtensions, setExtensions } from '../lib/extensions/registry.ts';
import { scanExtensions } from '../lib/extensions/loader.ts';
import { buildExtensionRenderers } from '../lib/extensions/builder.ts';
import { wireAgentPlugins, unwireAgentPlugins } from '../lib/extensions/wire-agent-plugins.ts';
import { unwireExtensionSkills } from '../lib/extensions/loader.ts';

export const extensionsRoutes = new Hono();

/** Spawn `git clone <url> <dir>` and return exit code + stderr */
async function gitClone(url: string, targetDir: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(['git', 'clone', url, targetDir], {
    stdout: 'ignore', stderr: 'pipe',
  });
  const exit = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { ok: exit === 0, stderr: stderr.trim() };
}

/** Spawn `git pull` in a directory */
async function gitPull(dir: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(['git', 'pull'], {
    cwd: dir, stdout: 'ignore', stderr: 'pipe',
  });
  const exit = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { ok: exit === 0, stderr: stderr.trim() };
}

/** Read git remote origin URL from a directory */
async function readGitRemoteUrl(dir: string): Promise<string | null> {
  const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
    cwd: dir, stdout: 'pipe', stderr: 'ignore',
  });
  await proc.exited;
  const url = (await new Response(proc.stdout).text()).trim();
  return url || null;
}

// POST /api/extensions/install
extensionsRoutes.post('/install', async (c) => {
  let body: { gitUrl?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { gitUrl } = body;
  if (!gitUrl) return c.json({ error: 'gitUrl is required' }, 400);

  const tempId = `_install_${randomUUID()}`;
  const tempDir = join(AGEMON_DIR, 'extensions', tempId);

  try {
    await mkdir(join(AGEMON_DIR, 'extensions'), { recursive: true });

    const clone = await gitClone(gitUrl, tempDir);
    if (!clone.ok) {
      await rm(tempDir, { recursive: true, force: true });
      return c.json({ error: 'git_clone_failed', details: clone.stderr }, 500);
    }

    // Read manifest
    let manifest: import('@agemon/shared').ExtensionManifest | null = null;
    const mf = Bun.file(join(tempDir, 'agemon-extension.json'));
    if (await mf.exists()) manifest = await mf.json();

    if (!manifest?.id || !manifest?.name || !manifest?.version) {
      await rm(tempDir, { recursive: true, force: true });
      return c.json({ error: 'invalid_manifest', details: 'Missing id, name, or version' }, 422);
    }

    // Check for ID collision
    const existing = getExtension(manifest.id);
    if (existing) {
      await rm(tempDir, { recursive: true, force: true });
      return c.json({ error: 'already_installed', id: manifest.id }, 409);
    }

    // Move to final location
    const finalDir = join(AGEMON_DIR, 'extensions', manifest.id);
    await rename(tempDir, finalDir);

    // Run load cycle
    const { EventBridge } = await import('../lib/extensions/event-bridge.ts');
    const { broadcast } = await import('../server.ts');
    const bridge = new EventBridge(broadcast);

    // Targeted load: rescan all (including bundled) to get the new extension
    // The startup scan options (extraDirs for bundled) aren't available here,
    // so use merge strategy: keep existing extensions, add the new one.
    const freshAll = await scanExtensions(AGEMON_DIR, bridge);
    const freshExt = freshAll.find(e => e.manifest.id === manifest!.id);
    if (freshExt) {
      const existing = getExtensions().filter(e => e.manifest.id !== manifest!.id);
      setExtensions([...existing, freshExt]);
    }
    // buildExtensionRenderers clears all caches — pass full extension list
    await buildExtensionRenderers(getExtensions());
    broadcast({ type: 'extensions_changed', extensionIds: [manifest.id] });

    return c.json({ id: manifest.id, version: manifest.version, status: 'loaded' });
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return c.json({ error: 'internal_error', details: (err as Error).message }, 500);
  }
});

// POST /api/extensions/:id/upgrade
extensionsRoutes.post('/:id/upgrade', async (c) => {
  const id = c.req.param('id');
  const ext = getExtension(id);
  if (!ext) return c.json({ error: 'not_found' }, 404);

  // Check it's git-managed
  const gitUrl = await readGitRemoteUrl(ext.dir);
  if (!gitUrl) return c.json({ error: 'not_git_managed' }, 409);

  const previousVersion = ext.manifest.version;
  const pull = await gitPull(ext.dir);
  if (!pull.ok) return c.json({ error: 'git_pull_failed', details: pull.stderr }, 500);

  // Re-run load cycle
  const { EventBridge } = await import('../lib/extensions/event-bridge.ts');
  const { broadcast } = await import('../server.ts');
  const bridge = new EventBridge(broadcast);

  const freshAll = await scanExtensions(AGEMON_DIR, bridge);
  const upgraded = freshAll.find(e => e.manifest.id === id);
  if (!upgraded) return c.json({ error: 'reload_failed' }, 500);
  const existing = getExtensions().filter(e => e.manifest.id !== id);
  setExtensions([...existing, upgraded]);

  // buildExtensionRenderers clears all caches — pass full extension list
  await buildExtensionRenderers(getExtensions());
  await wireAgentPlugins(upgraded.manifest, upgraded.dir);
  broadcast({ type: 'extensions_changed', extensionIds: [id] });

  return c.json({ id, version: upgraded.manifest.version, previousVersion });
});

// DELETE /api/extensions/:id
extensionsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ext = getExtension(id);
  if (!ext) return c.json({ error: 'not_found' }, 404);
  if (ext.type === 'bundled') return c.json({ error: 'bundled' }, 409);

  // onUnload
  if (typeof ext.exports.onUnload === 'function') {
    try { await ext.exports.onUnload(); } catch (e) {
      console.warn(`[extension:${id}] onUnload error:`, (e as Error).message);
    }
  }

  // Remove skill symlinks and agent plugin symlinks
  await unwireExtensionSkills(ext.manifest, AGEMON_DIR);
  await unwireAgentPlugins(ext.manifest);

  // Remove from registry
  setExtensions(getExtensions().filter(e => e.manifest.id !== id));

  // Remove extension directory
  try {
    await rm(ext.dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[extension:${id}] could not remove dir ${ext.dir}:`, (err as Error).message);
  }

  const { broadcast } = await import('../server.ts');
  broadcast({ type: 'extensions_changed', extensionIds: [id] });

  return c.json({ id, removed: true });
});

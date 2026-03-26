/**
 * Wire agent plugin symlinks for extensions that declare `agentPlugins`.
 *
 * For each extension that has `agentPlugins` in its manifest, for each declared
 * agentType, creates a symlink in the agent's global plugin discovery directory:
 *   {globalDir}/agemon/{extensionId} → {extensionDir}/{agentPluginsSubdir}
 *
 * The managed directory `{globalDir}/agemon/` is a real directory (not a flat
 * symlink to ~/.agemon/extensions/). Individual extension symlinks are added,
 * replaced on upgrade, and removed on unload.
 */
import { symlink, unlink, mkdir, stat, lstat } from 'fs/promises';
import { join } from 'path';
import { AGENT_CONFIGS } from '../agents.ts';
import type { ExtensionManifest } from '@agemon/shared';

export async function wireAgentPlugins(manifest: ExtensionManifest, extensionDir: string): Promise<void> {
  if (!manifest.agentPlugins || Object.keys(manifest.agentPlugins).length === 0) return;

  for (const [agentType, relativeSubdir] of Object.entries(manifest.agentPlugins)) {
    // agentPlugins keys are `string` in the shared manifest type (shared/ can't import AgentType from backend)
    const agentConfig = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
    if (!agentConfig) {
      console.warn(`[extension:${manifest.id}] agentPlugins declares unknown agentType "${agentType}", skipping`);
      continue;
    }

    for (const pluginPath of agentConfig.pluginPaths) {
      if (!pluginPath.globalDir) continue;

      const managedDir = join(pluginPath.globalDir, 'agemon');
      const linkPath = join(managedDir, manifest.id);
      const targetPath = join(extensionDir, relativeSubdir);

      // Verify the target subdir actually exists
      try {
        const s = await stat(targetPath);
        if (!s.isDirectory()) {
          console.warn(`[extension:${manifest.id}] agentPlugins.${agentType} target "${targetPath}" is not a directory, skipping`);
          continue;
        }
      } catch {
        console.warn(`[extension:${manifest.id}] agentPlugins.${agentType} target "${targetPath}" not found, skipping`);
        continue;
      }

      // Ensure the managed directory is a real directory (not a flat symlink).
      // If it's currently a symlink (old layout), remove it first so we can
      // create a real directory in its place.
      // NOTE: This migration (symlink → real directory) is not safe for concurrent
      // scan calls. Multiple extensions scanning simultaneously could race here.
      // In practice, startup is sequential so this is acceptable for now.
      // TODO: Add a lock or idempotent check if concurrent scanning is added.
      try {
        const managedStat = await lstat(managedDir);
        if (managedStat.isSymbolicLink()) {
          await unlink(managedDir);
          console.info(`[extension:${manifest.id}] replaced flat symlink at ${managedDir} with real directory`);
        }
      } catch {
        // Not found — that's fine, mkdir below will create it
      }

      await mkdir(managedDir, { recursive: true });

      // Remove existing symlink before recreating (handles upgrade)
      try {
        await lstat(linkPath);
        await unlink(linkPath);
      } catch {
        // Not found — that's fine
      }

      try {
        await symlink(targetPath, linkPath);
        console.info(`[extension:${manifest.id}] wired agent plugin: ${agentType} → ${targetPath}`);
      } catch (err) {
        console.warn(`[extension:${manifest.id}] could not wire agent plugin for ${agentType}:`, (err as Error).message);
      }
    }
  }
}

export async function unwireAgentPlugins(manifest: ExtensionManifest): Promise<void> {
  if (!manifest.agentPlugins) return;

  for (const agentType of Object.keys(manifest.agentPlugins)) {
    // agentPlugins keys are `string` in the shared manifest type (shared/ can't import AgentType from backend)
    const agentConfig = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
    if (!agentConfig) continue;

    for (const pluginPath of agentConfig.pluginPaths) {
      if (!pluginPath.globalDir) continue;
      const linkPath = join(pluginPath.globalDir, 'agemon', manifest.id);
      try {
        await unlink(linkPath);
        console.info(`[extension:${manifest.id}] removed agent plugin symlink: ${agentType}`);
      } catch {
        // Already gone — ignore
      }
    }
  }
}

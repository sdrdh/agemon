import { mkdir, symlink, lstat, stat, readdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { db } from './db/client.ts';
import { buildSessionDb, insertSession } from './lib/session-store.ts';
import type { AgentType } from '@agemon/shared';
import { AGEMON_DIR } from './lib/git.ts';
import { getAllPluginPaths, getAllSkillPaths } from './lib/agents.ts';
import { createApp, websocket } from './app.ts';
import { registerBuiltinAgents } from './lib/plugins/agent-registry.ts';
import type { RepoDiff } from './lib/plugins/workspace.ts';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const AGEMON_KEY = process.env.AGEMON_KEY ?? '';

if (!AGEMON_KEY) {
  console.error('[error] AGEMON_KEY is not set — exiting');
  process.exit(1);
}

// Ensure ~/.agemon base dirs exist before DB/migrations
await mkdir(join(AGEMON_DIR, 'repos'), { recursive: true });
await mkdir(join(AGEMON_DIR, 'tasks'), { recursive: true });
await mkdir(join(AGEMON_DIR, 'plugins'), { recursive: true });
await mkdir(join(AGEMON_DIR, 'skills'), { recursive: true });
await mkdir(join(AGEMON_DIR, 'sessions'), { recursive: true });
console.info(`[agemon] data directory: ${AGEMON_DIR}`);

// NOTE: Filesystem migration (runFilesystemMigration) removed — all data is now file-based.
// The old agemon.db on-disk SQLite is no longer used.

// Build in-memory SQLite projection from session.json files (must run before recoverInterruptedSessions)
buildSessionDb(AGEMON_DIR);

// Build in-memory task DB from task JSON files (must run before migrations + plugins)
const { buildTaskDb } = await import('./lib/task-store.ts');
const taskPluginDataDir = join(AGEMON_DIR, 'plugins', 'tasks', 'data');
await mkdir(taskPluginDataDir, { recursive: true });
buildTaskDb(taskPluginDataDir);

// Load in-memory stores from filesystem
import { loadApprovalsFromDisk } from './lib/approval-store.ts';
import { loadInputsFromDisk } from './lib/input-store.ts';
import { loadApprovalRules } from './lib/approval-rules-store.ts';
import { loadMcpServers } from './lib/mcp-server-store.ts';
loadApprovalsFromDisk();
loadInputsFromDisk();
loadApprovalRules();
loadMcpServers();

// Wire global agemon plugins into each agent's discovery path
for (const pluginPath of getAllPluginPaths()) {
  await mkdir(pluginPath.globalDir, { recursive: true });
  const link = join(pluginPath.globalDir, 'agemon');
  try {
    await lstat(link);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      try {
        await symlink(join(AGEMON_DIR, 'plugins'), link);
        console.info(`[agemon] linked ${link} -> ${AGEMON_DIR}/plugins`);
      } catch (symlinkErr) {
        console.warn(`[agemon] could not create plugin symlink:`, (symlinkErr as Error).message);
      }
    } else {
      console.warn(`[agemon] unexpected error checking plugin symlink ${link}:`, err.message);
    }
  }
}

// Wire global agemon skills into each agent's discovery path
// Per Agent Skills spec (agentskills.io), agents scan ~/.agents/skills/ (cross-client)
// and ~/.<client>/skills/ (client-specific) at user level.
for (const skillPath of getAllSkillPaths()) {
  if (!skillPath.globalDir) continue;
  await mkdir(skillPath.globalDir, { recursive: true });
  const link = join(skillPath.globalDir, 'agemon');
  try {
    await lstat(link);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      try {
        await symlink(join(AGEMON_DIR, 'skills'), link);
        console.info(`[agemon] linked ${link} -> ${AGEMON_DIR}/skills`);
      } catch (symlinkErr) {
        console.warn(`[agemon] could not create skill symlink:`, (symlinkErr as Error).message);
      }
    } else {
      console.warn(`[agemon] unexpected error checking skill symlink ${link}:`, err.message);
    }
  }
}

// NOTE: SQLite migrations removed — no on-disk DB. All stores load from JSON files above.

// Register built-in agents before plugins are scanned (plugins may extend the registry)
registerBuiltinAgents();

// Register built-in workspace providers
const { workspaceRegistry } = await import('./lib/plugins/workspace-registry.ts');
const { defaultTaskWorkspaceProvider } = await import('./lib/plugins/workspace-default.ts');

// git-worktree: existing behaviour (git worktrees + CLAUDE.md generation)
workspaceRegistry.register('git-worktree', defaultTaskWorkspaceProvider);

// cwd: run in any local directory, no git setup required
import { simpleGit } from 'simple-git';

workspaceRegistry.register('cwd', {
  async prepare(session) {
    const cwd = session.meta.cwd as string | undefined;
    if (!cwd) throw new Error('[workspace:cwd] session.meta.cwd is required');
    if (!(await stat(cwd).then(() => true).catch(() => false)))
      throw new Error(`[workspace:cwd] directory not found: ${cwd}`);
    return { cwd };
  },

  async getDiff(meta: Record<string, unknown>): Promise<RepoDiff[] | null> {
    const cwd = meta.cwd as string | undefined;
    if (!cwd) return null;

    const git = simpleGit(cwd);
    const isRepo = await git.checkIsRepo().catch(() => false);

    if (isRepo) {
      const diff = await git.diff(['-U20', '--', '.']).catch(() => '');
      const repoName = cwd.split('/').pop() || cwd;
      return diff ? [{ repoName, cwd, diff }] : null;
    }

    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
    const results: RepoDiff[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subpath = join(cwd, entry.name);
        const subgit = simpleGit(subpath);
        const isSubrepo = await subgit.checkIsRepo().catch(() => false);

        if (isSubrepo) {
          const diff = await subgit.diff(['-U20', '--', '.']).catch(() => '');
          if (diff) results.push({ repoName: entry.name, cwd: subpath, diff });
        }
      }
    }

    return results.length > 0 ? results : null;
  },
});

// Auto-upgrade on startup (only when setting enabled AND under systemd)
try {
  const autoUpgrade = db.getSetting('auto_upgrade');
  if (autoUpgrade === 'true') {
    const { isRunningUnderSystemd, checkForUpdates } = await import('./lib/version.ts');
    if (isRunningUnderSystemd()) {
      const channel = (db.getSetting('release_channel') ?? 'stable') as import('@agemon/shared').ReleaseChannel;
      const branch = db.getSetting('release_branch') ?? undefined;
      const check = await checkForUpdates(true, channel, branch);
      if (check.has_update) {
        console.info(`[agemon] auto-upgrading to ${check.latest} (channel: ${channel})...`);
        const { getUpdateStrategy } = await import('./lib/updater.ts');
        const strategy = getUpdateStrategy();
        const result = await strategy.applyUpdate(check.latest_tag, channel);
        if (result.ok) {
          console.info(`[agemon] upgrade complete (${result.from_version} → ${result.to_version}), restarting...`);
          setTimeout(() => process.exit(0), 100);
        } else {
          console.warn(`[agemon] auto-upgrade failed: ${result.message}`);
        }
      }
    }
  }
} catch (err) {
  console.warn('[agemon] auto-upgrade check failed, continuing with current version:', (err as Error).message);
}

// Create app
const { app, broadcast } = createApp({ key: AGEMON_KEY });

// Export broadcast for use in acp.ts and context.ts
export { broadcast };

// Mount routes
const { sessionsRoutes } = await import('./routes/sessions.ts');
app.route('/api', sessionsRoutes);

const { approvalsRoutes } = await import('./routes/approvals.ts');
app.route('/api', approvalsRoutes);

const { dashboardRoutes } = await import('./routes/dashboard.ts');
app.route('/api', dashboardRoutes);

const { systemRoutes } = await import('./routes/system.ts');
app.route('/api', systemRoutes);

const { renderersRoutes } = await import('./routes/renderers.ts');
app.route('/api/renderers', renderersRoutes);

const { tasksRoutes } = await import('./routes/tasks.ts');
app.route('/api', tasksRoutes);

// ─── Plugins ─────────────────────────────────────────────────────────────────
const { EventBridge } = await import('./lib/plugins/event-bridge.ts');
const pluginBridge = new EventBridge(broadcast);

// Wire EventBridge into ACP lifecycle NOW — before plugins load so any session
// events emitted during onLoad (or crash recovery) flow through the bridge.
const { setBridge } = await import('./lib/acp/lifecycle.ts');
setBridge(pluginBridge);

// Build sessionApi for plugin context — dynamic import avoids circular dep
// (spawn.ts imports broadcast from server.ts, which is now defined above).
const { spawnSessionById } = await import('./lib/acp/spawn.ts');
const sessionApi = {
  createSession: ({ agentType, meta }: { agentType: AgentType; meta: Record<string, unknown> }) =>
    insertSession({ id: randomUUID(), meta_json: JSON.stringify(meta), agent_type: agentType, pid: null }),
  spawnSession: (sessionId: string) => spawnSessionById(sessionId),
};

const { scanPlugins } = await import('./lib/plugins/loader.ts');
const { setPlugins } = await import('./lib/plugins/registry.ts');
const { mountPluginRoutes } = await import('./lib/plugins/mount.ts');

// Scan ~/.agemon/plugins/ AND repo-bundled plugins/ directory
const repoPluginsDir = join(import.meta.dir, '../../plugins');
const plugins = await scanPlugins(AGEMON_DIR, pluginBridge, { extraDirs: [repoPluginsDir], sessionApi });
setPlugins(plugins);
mountPluginRoutes(app, plugins, AGEMON_DIR);
console.info(`[agemon] loaded ${plugins.length} plugin(s)${plugins.length ? ': ' + plugins.map(p => p.manifest.id).join(', ') : ''}`);

// Build plugin renderers and watch for changes
const { buildPluginRenderers, watchPlugins, watchPluginsDir } = await import('./lib/plugins/builder.ts');
await buildPluginRenderers(plugins);
watchPlugins(plugins, broadcast);
watchPluginsDir(AGEMON_DIR, broadcast, pluginBridge);

// ─── Static File Serving (production) ────────────────────────────────────────
// Serve frontend/dist/ when it exists. Must be after all API/MCP routes.
const FRONTEND_DIST = join(import.meta.dir, '../../frontend/dist');
const frontendExists = await stat(join(FRONTEND_DIST, 'index.html')).then(() => true).catch(() => false);

if (frontendExists) {
  const indexHtml = Bun.file(join(FRONTEND_DIST, 'index.html'));

  // Serve static assets (js, css, images, etc.)
  app.use('*', async (c, next) => {
    const urlPath = new URL(c.req.url).pathname;

    // Let API, WS, and MCP routes pass through to their handlers
    if (urlPath.startsWith('/api') || urlPath.startsWith('/ws')) {
      return next();
    }

    // Only serve static files for GET/HEAD requests
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    // Try to serve a static file
    const filePath = join(FRONTEND_DIST, urlPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback — serve index.html for all non-file routes
    return new Response(indexHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  });

  console.info('[agemon] serving frontend from frontend/dist/');
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[agemon] frontend/dist/ not found — run "cd frontend && bun run build" first');
}

// ─── Start ────────────────────────────────────────────────────────────────────
Bun.serve({ fetch: app.fetch, websocket, port: PORT, hostname: HOST });
console.log(`[agemon] backend listening on http://${HOST}:${PORT}`);

// ─── Crash Recovery + Graceful Shutdown ──────────────────────────────────────
// Dynamic import avoids circular dependency: acp modules import broadcast from server.ts
const { recoverInterruptedSessions, shutdownAllSessions } = await import('./lib/acp/index.ts');
await recoverInterruptedSessions();

// ─── Periodic Update Check ──────────────────────────────────────────────────
// Check for updates every 6 hours and broadcast to connected clients
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
async function broadcastUpdateCheck() {
  try {
    const { checkForUpdates } = await import('./lib/version.ts');
    const channel = (db.getSetting('release_channel') ?? 'stable') as import('@agemon/shared').ReleaseChannel;
    const branch = db.getSetting('release_branch') ?? undefined;
    const result = await checkForUpdates(true, channel, branch);
    if (result.has_update && result.should_notify) {
      broadcast({ type: 'update_available', version: result.latest, should_notify: true });
    }
  } catch (err) { console.warn('[agemon] periodic update check failed:', (err as Error).message); }
}
// Initial check after 30s (let server settle), then every 6h
setTimeout(broadcastUpdateCheck, 30_000);
setInterval(broadcastUpdateCheck, UPDATE_CHECK_INTERVAL);

process.on('SIGINT', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('[agemon] shutting down...');
  await shutdownAllSessions();
  process.exit(0);
});

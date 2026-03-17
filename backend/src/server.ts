import { mkdir, symlink, lstat, stat } from 'fs/promises';
import { join } from 'path';
import { runMigrations, db } from './db/client.ts';
import { AGEMON_DIR } from './lib/git.ts';
import { getAllPluginPaths, getAllSkillPaths } from './lib/agents.ts';
import { createApp, websocket } from './app.ts';

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
console.info(`[agemon] data directory: ${AGEMON_DIR}`);

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

// Run migrations
try {
  runMigrations();
} catch (err) {
  console.error('[db] migration failed — exiting', err);
  process.exit(1);
}

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

// Export broadcast for use in acp.ts, context.ts, routes/tasks.ts
export { broadcast };

// Mount routes
const { tasksRoutes } = await import('./routes/tasks.ts');
app.route('/api', tasksRoutes);

const { sessionsRoutes } = await import('./routes/sessions.ts');
app.route('/api', sessionsRoutes);

const { approvalsRoutes } = await import('./routes/approvals.ts');
app.route('/api', approvalsRoutes);

const { mcpConfigRoutes } = await import('./routes/mcp-config.ts');
app.route('/api', mcpConfigRoutes);

const { skillsRoutes } = await import('./routes/skills.ts');
app.route('/api', skillsRoutes);

const { dashboardRoutes } = await import('./routes/dashboard.ts');
app.route('/api', dashboardRoutes);

const { systemRoutes } = await import('./routes/system.ts');
app.route('/api', systemRoutes);

// ─── Plugins ─────────────────────────────────────────────────────────────────
const { scanPlugins } = await import('./lib/plugins/loader.ts');
const { setPlugins } = await import('./lib/plugins/registry.ts');
const { mountPluginRoutes } = await import('./lib/plugins/mount.ts');

const plugins = await scanPlugins(AGEMON_DIR);
setPlugins(plugins);
mountPluginRoutes(app, plugins);
console.info(`[agemon] loaded ${plugins.length} plugin(s)${plugins.length ? ': ' + plugins.map(p => p.manifest.id).join(', ') : ''}`);

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
    if (urlPath.startsWith('/api') || urlPath.startsWith('/ws') || urlPath.startsWith('/p/')) {
      return next();
    }

    // Only serve static files for GET requests
    if (c.req.method !== 'GET') return next();

    // Try to serve a static file
    const filePath = join(FRONTEND_DIST, urlPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback — serve index.html for all non-file routes
    return new Response(indexHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
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

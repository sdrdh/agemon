import { mkdir, symlink, lstat } from 'fs/promises';
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

// ─── MCP Server ──────────────────────────────────────────────────────────────
const { getMcpServer, getMcpTransport } = await import('./lib/mcp/server.ts');
const mcpTransport = getMcpTransport();
const mcpServer = getMcpServer();

// app.all is required: MCP Streamable HTTP uses POST for RPC, GET for SSE, DELETE for session teardown
app.all('/mcp', async (c) => {
  if (!mcpServer.isConnected()) {
    await mcpServer.connect(mcpTransport);
  }
  return mcpTransport.handleRequest(c);
});

// ─── Start ────────────────────────────────────────────────────────────────────
Bun.serve({ fetch: app.fetch, websocket, port: PORT, hostname: HOST });
console.log(`[agemon] backend listening on http://${HOST}:${PORT}`);

// ─── Crash Recovery + Graceful Shutdown ──────────────────────────────────────
// Dynamic import avoids circular dependency: acp modules import broadcast from server.ts
const { recoverInterruptedSessions, shutdownAllSessions } = await import('./lib/acp/index.ts');
recoverInterruptedSessions();

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

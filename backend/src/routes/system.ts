import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { CURRENT_VERSION, isRunningUnderSystemd, checkForUpdates } from '../lib/version.ts';
import { getUpdateStrategy } from '../lib/updater.ts';
import type { VersionInfo, ReleaseChannel, RestartResult } from '@agemon/shared';

const SETTINGS_ALLOWLIST = new Set([
  'auto_upgrade',
  'auto_resume_sessions',
  'release_channel',
  'release_branch',
]);

export const systemRoutes = new Hono();

/** Read the configured release channel + branch from settings. */
function getChannelConfig(): { channel: ReleaseChannel; branch: string | undefined } {
  const channel = (db.getSetting('release_channel') ?? 'stable') as ReleaseChannel;
  const branch = db.getSetting('release_branch') ?? undefined;
  return { channel, branch };
}

// GET /version — public (no auth required, bypass handled in app.ts)
systemRoutes.get('/version', (c) => {
  const info: VersionInfo = {
    current: CURRENT_VERSION,
    running_under_systemd: isRunningUnderSystemd(),
  };
  return c.json(info);
});

// GET /version/check — check for updates
systemRoutes.get('/version/check', async (c) => {
  const refresh = c.req.query('refresh') === 'true';
  const { channel, branch } = getChannelConfig();
  const result = await checkForUpdates(refresh, channel, branch);
  return c.json(result);
});

// POST /update — run update strategy
systemRoutes.post('/update', async (c) => {
  const body = await c.req.json<{ target_tag?: string }>().catch(() => ({} as { target_tag?: string }));
  const { channel, branch } = getChannelConfig();

  // Get the latest version info to determine target ref
  const versionCheck = await checkForUpdates(false, channel, branch);
  const targetRef = body.target_tag ?? versionCheck.latest_tag;

  // Validate ref format — tags must be semver-ish, branches are validated by git
  if (channel !== 'branch' && !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(targetRef)) {
    // Allow nightly tags like nightly-2026-03-14
    if (!/^nightly-\d{4}-\d{2}-\d{2}/.test(targetRef)) {
      return c.json({ error: 'Bad Request', message: 'Invalid version tag format', statusCode: 400 }, 400);
    }
  }

  const strategy = getUpdateStrategy();
  const result = await strategy.applyUpdate(targetRef, channel);
  return c.json(result);
});

// POST /restart — graceful restart
systemRoutes.post('/restart', async (c) => {
  if (!isRunningUnderSystemd()) {
    const result: RestartResult = {
      ok: false,
      reason: 'not_supervised',
      message: 'Server is not running under a process supervisor (systemd/launchd). Restart manually.',
    };
    return c.json(result);
  }

  const { broadcast } = await import('../server.ts');
  const { shutdownAllSessions } = await import('../lib/acp/index.ts');

  // Notify all WS clients
  broadcast({ type: 'server_restarting' });

  // Stop all running agent sessions
  await shutdownAllSessions();

  const result: RestartResult = {
    ok: true,
    reason: 'shutting_down',
    message: 'Server is restarting...',
  };

  // Grace period for response to flush before exit
  setTimeout(() => process.exit(0), 500);

  return c.json(result);
});

// GET /settings — all settings
systemRoutes.get('/settings', (c) => {
  return c.json(db.getAllSettings());
});

// GET /settings/:key — single setting
systemRoutes.get('/settings/:key', (c) => {
  const key = c.req.param('key');
  const value = db.getSetting(key);
  return c.json({ value });
});

// POST /settings — upsert setting (with allowlist)
systemRoutes.post('/settings', async (c) => {
  const body = await c.req.json<{ key?: string; value?: string }>();
  const { key, value } = body;

  if (!key || typeof key !== 'string') {
    return c.json({ error: 'Bad Request', message: 'Missing or invalid "key"', statusCode: 400 }, 400);
  }
  if (value === undefined || value === null || typeof value !== 'string') {
    return c.json({ error: 'Bad Request', message: 'Missing or invalid "value"', statusCode: 400 }, 400);
  }
  if (!SETTINGS_ALLOWLIST.has(key)) {
    return c.json({ error: 'Bad Request', message: `Setting "${key}" is not allowed. Allowed: ${[...SETTINGS_ALLOWLIST].join(', ')}`, statusCode: 400 }, 400);
  }

  db.setSetting(key, value);
  return c.json({ key, value });
});

import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { PluginManifest } from '@agemon/shared';

// ─── Plugin Module (default export shape from entryPoint) ────────────────────

export interface PluginModule {
  onLoad(ctx: PluginContext): PluginExports | Promise<PluginExports>;
}

export interface PluginExports {
  /** Hono sub-app for JSON API routes — mounted at /api/plugins/{id}/ */
  apiRoutes?: Hono;
  /** Hono sub-app for full-page HTML views — mounted at /p/{id}/ */
  pageRoutes?: Hono;
}

// ─── Plugin Context (passed to onLoad) ───────────────────────────────────────

export interface PluginContext {
  agemonDir: string;
  db: Database;
  getSetting(key: string): string | null;
  logger: PluginLogger;
}

export interface PluginLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Loaded Plugin (runtime state) ───────────────────────────────────────────

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  exports: PluginExports;
}

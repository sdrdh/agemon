import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { PluginManifest, CustomRendererManifest } from '@agemon/shared';

// ─── Plugin Module (default export shape from entryPoint) ────────────────────

export interface PluginModule {
  onLoad(ctx: PluginContext): PluginExports | Promise<PluginExports>;
}

export interface CustomRenderer {
  manifest: CustomRendererManifest;
  component: unknown;  // React component (will be served as raw TSX)
  dir: string;  // plugin directory, for locating component files
}

export interface PluginExports {
  /** Hono sub-app for JSON API routes — mounted at /api/plugins/{id}/ */
  apiRoutes?: Hono;
  /** Hono sub-app for full-page HTML views — mounted at /p/{id}/ */
  pageRoutes?: Hono;
  /** Custom React renderers for chat messages */
  renderers?: CustomRenderer[];
  /** React pages - served within the main React app */
  pages?: PluginPage[];
}

export interface PluginPage {
  path: string;           // e.g. '/memory' → /p/{pluginId}/memory
  component: string;      // name of component in renderers/ directory
  label?: string;         // human-readable label (for nav if not using manifest.navLabel)
}

// ─── Plugin Context (passed to onLoad) ───────────────────────────────────────

export interface PluginContext {
  agemonDir: string;
  pluginDir: string;  // directory containing the plugin
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

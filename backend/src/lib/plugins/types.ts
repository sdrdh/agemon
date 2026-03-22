import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { PluginManifest, CustomRendererManifest, ServerEventPayload, AgentSession, AgentType } from '@agemon/shared';
import type { AgentProvider } from './agent-registry.ts';

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
  /** Agent providers this plugin registers */
  agentProviders?: AgentProvider[];
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
  /** Persistent plugin data directory: ~/.agemon/plugins/{pluginId}/data/ */
  pluginDataDir: string;
  /** Core DB (in-memory SQLite) — sessions table for reading. READ-ONLY by convention. */
  coreDb: Database;
  /** Write a file atomically (sync, POSIX-safe rename swap). */
  atomicWrite(path: string, data: string): void;
  getSetting(key: string): string | null;
  logger: PluginLogger;
  /** Register a blocking hook (awaited in priority order) */
  hook(event: string, handler: (payload: unknown) => Promise<void>, opts?: { priority?: number }): void;
  /** Register a fire-and-forget listener */
  on(event: string, handler: (payload: unknown) => void): void;
  /** Emit an event (awaits hooks, fires listeners) */
  emit(event: string, payload: unknown): Promise<void>;
  /** Broadcast a WebSocket event to all connected clients */
  broadcast(wsEvent: ServerEventPayload): void;
  /**
   * Insert a session record into the in-memory DB without spawning a process.
   * Use before spawnSession() to allow plugin setup (e.g. worktree creation) between create and spawn.
   */
  createSession(opts: { agentType: AgentType; meta: Record<string, unknown> }): AgentSession;
  /**
   * Spawn the process and run the ACP handshake for an already-created session.
   * The session must have been created via createSession().
   */
  spawnSession(sessionId: string): AgentSession;
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

import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { PluginManifest, CustomRendererManifest, ServerEventPayload, AgentSession, AgentType } from '@agemon/shared';
import type { AgentProvider } from './agent-registry.ts';

// ─── Plugin Module (default export shape from entryPoint) ────────────────────

export interface PluginModule {
  onLoad(ctx: PluginContext): PluginExports | Promise<PluginExports>;
  /** Optional cleanup hook. Called before hot-reload and on server shutdown. */
  onUnload?(): void | Promise<void>;
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
  /** Typed query functions exposed to other plugins via ctx.query(pluginId, name, ...args) */
  queries?: Record<string, (...args: unknown[]) => unknown>;
}

export interface PluginPage {
  path: string;           // e.g. '/memory' → /p/{pluginId}/memory
  component: string;      // name of component in renderers/ directory
  label?: string;         // human-readable label (for nav if not using manifest.navLabel)
}

// ─── Plugin Store (simple KV store backed by flat JSON file) ─────────────────

export interface PluginStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  getJson<T = unknown>(key: string): T | null;
  setJson(key: string, value: unknown): void;
  delete(key: string): void;
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
  /** Read a per-plugin setting. Env var AGEMON_PLUGIN_{ID}_{KEY} takes precedence. */
  getSetting(key: string): string | null;
  /** Persist a per-plugin setting to ~/.agemon/plugins/{id}/data/settings.json. */
  setSetting(key: string, value: string): void;
  /** Simple KV store backed by ~/.agemon/plugins/{id}/data/store.json. */
  store: PluginStore;
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
  /**
   * Call a named query exported by another plugin.
   * The target plugin must export it via `PluginExports.queries`.
   */
  query(pluginId: string, name: string, ...args: unknown[]): unknown;
  /**
   * Workspace registry — register or look up named workspace providers.
   * Plugins that provide workspace environments (e.g. git worktrees) expose them here.
   */
  workspaces: WorkspaceRegistry;
}

export interface WorkspaceRegistry {
  register(id: string, provider: WorkspaceProvider): void;
  get(id: string): WorkspaceProvider | undefined;
  list(): string[];
}

export interface WorkspaceProvider {
  /** Resolve the filesystem path for a given task. */
  resolvePath(taskId: string): string | Promise<string>;
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
  /** False if any required setting (per manifest.settings) is missing. */
  configured: boolean;
}

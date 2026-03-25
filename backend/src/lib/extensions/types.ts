import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { ExtensionManifest, CustomRendererManifest, ServerEventPayload, AgentSession, AgentType } from '@agemon/shared';
import type { AgentProvider } from './agent-registry.ts';
import type { WorkspaceProvider } from './workspace.ts';

// ─── Extension Module (default export shape from entryPoint) ─────────────────

export interface ExtensionModule {
  onLoad(ctx: ExtensionContext): ExtensionExports | Promise<ExtensionExports>;
  /** Optional cleanup hook. Called before hot-reload and on server shutdown. */
  onUnload?(): void | Promise<void>;
}

export interface CustomRenderer {
  manifest: CustomRendererManifest;
  component: unknown;  // React component (will be served as raw TSX)
  dir: string;  // extension directory, for locating component files
}

export interface ExtensionExports {
  /** Hono sub-app for JSON API routes — mounted at /api/extensions/{id}/ */
  apiRoutes?: Hono;
  /** Hono sub-app for full-page HTML views — mounted at /p/{id}/ */
  pageRoutes?: Hono;
  /** Custom React renderers for chat messages */
  renderers?: CustomRenderer[];
  /** React pages - served within the main React app */
  pages?: ExtensionPage[];
  /** Agent providers this extension registers */
  agentProviders?: AgentProvider[];
  /** Typed query functions exposed to other extensions via ctx.query(extensionId, name, ...args) */
  queries?: Record<string, (...args: unknown[]) => unknown>;
  /** Called before hot-reload replaces this extension's code. Use to clean up timers, listeners, etc. */
  onUnload?(): void | Promise<void>;
}

export interface ExtensionPage {
  path: string;           // e.g. '/memory' → /p/{extensionId}/memory
  component: string;      // name of component in renderers/ directory
  label?: string;         // human-readable label (for nav if not using manifest.navLabel)
}

// ─── Extension Store (simple KV store backed by flat JSON file) ──────────────

export interface ExtensionStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  getJson<T = unknown>(key: string): T | null;
  setJson(key: string, value: unknown): void;
  delete(key: string): void;
}

// ─── Extension Context (passed to onLoad) ────────────────────────────────────

export interface ExtensionContext {
  agemonDir: string;
  extensionDir: string;  // directory containing the extension
  /** Persistent extension data directory: ~/.agemon/extension-data/{extensionId}/ */
  extensionDataDir: string;
  /** Core DB (in-memory SQLite) — sessions table for reading. READ-ONLY by convention. */
  coreDb: Database;
  /** Write a file atomically (sync, POSIX-safe rename swap). */
  atomicWrite(path: string, data: string): void;
  /** Read a per-extension setting. Env var AGEMON_EXTENSION_{ID}_{KEY} takes precedence. */
  getSetting(key: string): string | null;
  /** Persist a per-extension setting to ~/.agemon/extension-data/{id}/settings.json. */
  setSetting(key: string, value: string): void;
  /** Simple KV store backed by ~/.agemon/extension-data/{id}/store.json. */
  store: ExtensionStore;
  logger: ExtensionLogger;
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
   */
  createSession(opts: { agentType: AgentType; meta: Record<string, unknown> }): AgentSession;
  /**
   * Spawn the process and run the ACP handshake for an already-created session.
   */
  spawnSession(sessionId: string): AgentSession;
  /**
   * Call a named query exported by another extension.
   */
  query(extensionId: string, name: string, ...args: unknown[]): unknown;
  /**
   * Workspace registry — register or look up named workspace providers.
   * Shared singleton across all extensions (cross-cutting concern).
   */
  workspaces: WorkspaceRegistry;
}

export interface WorkspaceRegistry {
  register(id: string, provider: WorkspaceProvider): void;
  get(id: string): WorkspaceProvider | undefined;
  list(): Array<{ id: string; provider: WorkspaceProvider }>;  // NOTE: corrected in Task 4 from string[]
}

export interface ExtensionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Loaded Extension (runtime state) ────────────────────────────────────────

export interface LoadedExtension {
  manifest: ExtensionManifest;
  dir: string;
  exports: ExtensionExports;
  /** False if any required setting (per manifest.settings) is missing. */
  configured: boolean;
  /** How the extension was discovered */
  type: 'bundled' | 'installed' | 'local';
}


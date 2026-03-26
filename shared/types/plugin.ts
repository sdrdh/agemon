// ─── Extension Manifest (agemon-extension.json) ───────────────────────────────
// Also accepts agemon-plugin.json (deprecated, fallback for one cycle)
// Shared between backend and frontend — no backend-only imports here.

export interface ExtensionSettingSchema {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'boolean' | 'select';
  /** Options list for type: 'select' */
  options?: string[];
  required?: boolean;
  description?: string;
}

export interface ExtensionNavItem {
  label: string;
  /** Lucide icon name, e.g. "Home" — resolved from window.__AGEMON__.LucideReact at runtime. */
  lucideIcon?: string;
  /** Compiled icon filename in dist/renderers/ (legacy approach, still supported). */
  icon?: string;
  /** Sub-path within the extension, e.g. '/' or '/kanban'. */
  path: string;
  /** Global sort order in the bottom nav (lower = earlier). */
  order?: number;
}

export interface ExtensionManifest {
  id: string;               // unique slug, e.g. "memory-cms"
  name: string;             // human-readable, e.g. "Memory CMS"
  version: string;          // semver
  description?: string;
  entryPoint?: string;      // relative path to TS/JS entry, e.g. "index.ts"
  hasPages?: boolean;       // true → extension serves full-page HTML at /p/{id}/
  /**
   * Multiple nav entries for this extension.
   * When present, takes precedence over navLabel/navLucideIcon/navOrder.
   */
  navItems?: ExtensionNavItem[];
  /**
   * Whether this extension appears in Settings → Extensions list. Defaults to true.
   * Set to false for headless/background extensions that shouldn't be user-visible.
   */
  showInSettings?: boolean;
  /**
   * Skill subdirectory names inside the extension's skills/ folder.
   * Each listed skill is symlinked into ~/.agemon/skills/{extensionId}--{skillName}/
   */
  skills?: string[];
  /**
   * Agent plugins bundled with this extension.
   * Keys are AgentType values (e.g. "claude-code"); values are relative paths
   * from the extension directory to the agent plugin subdirectory.
   * The loader wires symlinks into each agent's global plugin discovery directory.
   * e.g. { "claude-code": "agent-plugins/claude-code/" }
   */
  agentPlugins?: Record<string, string>;
  /**
   * Alternative chat input modes contributed by this extension.
   */
  inputExtensions?: InputExtensionManifest[];
  /**
   * Set by the loader at scan time based on which directory the extension was found in.
   * NOT written by extension authors in their agemon-extension.json file.
   */
  bundled?: boolean;
  /** Declarative settings schema — used to render settings UI and compute `configured` state. */
  settings?: ExtensionSettingSchema[];
  /** Component name in renderers/ for a custom settings UI (overrides auto-generated form). */
  settingsRenderer?: string;
  /**
   * Extension IDs this extension depends on. Loader uses topological sort to ensure
   * dependencies are loaded first. If a dependency is missing, a warning is logged
   * but this extension still attempts to load.
   */
  depends?: string[];
  /**
   * Extension API version this extension targets. The loader emits a warning if the
   * runtime API version (currently 1) does not match. Defaults to 1 if omitted.
   */
  apiVersion?: number;
}

// ─── Input Extensions ──────────────────────────────────────────────────────
// Extension-contributed alternative input modes shown as toolbar icons above the chat textarea.

export interface InputExtensionManifest {
  /** Unique within extension, e.g. "voice" */
  id: string;
  /** Tooltip / menu label */
  label: string;
  /** Lucide icon name, e.g. "Mic" — resolved from window.__AGEMON__.LucideReact at runtime */
  lucideIcon?: string;
  /** Filename in renderers/ without .tsx, e.g. "voice-input" */
  component: string;
}

// ─── Custom Renderers ──────────────────────────────────────────────────────
// Agent-authored React components that render specific message types in chat.

export interface CustomRendererManifest {
  name: string;             // unique name, e.g. "todo-list"
  messageType: string;      // eventType this renderer handles, e.g. "todo-list"
  label?: string;           // human-readable label for UI
  description?: string;
}

export interface CustomRendererExport {
  manifest: CustomRendererManifest;
  component: unknown;       // React component (actual import done at runtime)
}


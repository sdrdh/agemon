// ─── Plugin Manifest (agemon-plugin.json) ────────────────────────────────────
// Shared between backend and frontend — no backend-only imports here.

export interface PluginNavItem {
  label: string;
  /** Lucide icon name, e.g. "Home" — resolved from window.__AGEMON__.LucideReact at runtime. */
  lucideIcon?: string;
  /** Compiled icon filename in dist/renderers/ (legacy approach, still supported). */
  icon?: string;
  /** Sub-path within the plugin, e.g. '/' or '/kanban'. */
  path: string;
  /** Global sort order in the bottom nav (lower = earlier). */
  order?: number;
}

export interface PluginManifest {
  id: string;               // unique slug, e.g. "memory-cms"
  name: string;             // human-readable, e.g. "Memory CMS"
  version: string;          // semver
  description?: string;
  entryPoint?: string;      // relative path to TS/JS entry, e.g. "index.ts"
  hasPages?: boolean;       // true → plugin serves full-page HTML at /p/{id}/
  /**
   * Multiple nav entries for this plugin.
   * When present, takes precedence over navLabel/navLucideIcon/navOrder.
   */
  navItems?: PluginNavItem[];
  /** @deprecated Use navItems instead. */
  navLabel?: string;
  /** @deprecated Use navItems instead. */
  navIcon?: string;
  /** @deprecated Use navItems instead. */
  navLucideIcon?: string;
  /**
   * Whether this plugin appears in Settings → Plugins list. Defaults to true.
   * Set to false for headless/background plugins that shouldn't be user-visible.
   * Nav visibility is controlled independently via navLabel.
   */
  showInSettings?: boolean;
  /**
   * Skill subdirectory names inside the plugin's skills/ folder.
   * Each listed skill is symlinked into ~/.agemon/skills/{pluginId}--{skillName}/
   * making it discoverable by all agents via the existing agemon skills symlink.
   * e.g. ["memory-recall"] → plugin ships skills/memory-recall/SKILL.md
   */
  skills?: string[];
  /**
   * Alternative chat input modes contributed by this plugin.
   * Each entry adds an icon to the input toolbar; clicking it loads and shows the component.
   */
  inputExtensions?: InputExtensionManifest[];
  /** If true, plugin ships in the repo and is loaded from the bundled plugins dir. */
  bundled?: boolean;
  /** @deprecated Use navItems[].order instead. */
  navOrder?: number;
}

// ─── Input Extensions ─────────────────────────────────────────────────
// Plugin-contributed alternative input modes shown as toolbar icons above the chat textarea.

export interface InputExtensionManifest {
  /** Unique within plugin, e.g. "voice" */
  id: string;
  /** Tooltip / menu label */
  label: string;
  /** Lucide icon name, e.g. "Mic" — resolved from window.__AGEMON__.LucideReact at runtime */
  lucideIcon?: string;
  /** Filename in renderers/ without .tsx, e.g. "voice-input" */
  component: string;
}

// ─── Custom Renderers ─────────────────────────────────────────────────
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

// ─── Plugin Manifest (agemon-plugin.json) ────────────────────────────────────
// Shared between backend and frontend — no backend-only imports here.

export interface PluginManifest {
  id: string;               // unique slug, e.g. "memory-cms"
  name: string;             // human-readable, e.g. "Memory CMS"
  version: string;          // semver
  description?: string;
  entryPoint?: string;      // relative path to TS/JS entry, e.g. "index.ts"
  hasPages?: boolean;       // true → plugin serves full-page HTML at /p/{id}/
  navLabel?: string;        // if set, appears in bottom nav at /p/{id}/
  navIcon?: string;         // lucide icon name
  /**
   * Skill subdirectory names inside the plugin's skills/ folder.
   * Each listed skill is symlinked into ~/.agemon/skills/{pluginId}--{skillName}/
   * making it discoverable by all agents via the existing agemon skills symlink.
   * e.g. ["memory-recall"] → plugin ships skills/memory-recall/SKILL.md
   */
  skills?: string[];
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

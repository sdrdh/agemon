// ─── Plugin Manifest (agemon-plugin.json) ────────────────────────────────────
// Shared between backend and frontend — no backend-only imports here.

export interface PluginManifest {
  id: string;               // unique slug, e.g. "memory-cms"
  name: string;             // human-readable, e.g. "Memory CMS"
  version: string;          // semver
  description?: string;
  entryPoint?: string;      // relative path to TS/JS entry, e.g. "index.ts"
  hasPages?: boolean;       // true → plugin serves full-page HTML at /p/{id}/
}

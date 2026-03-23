# Plugin Settings — Design Plan

**Date:** 2026-03-22
**Status:** ✅ Complete (all 3 layers shipped)

---

## Problem

`ctx.getSetting(key)` reads from the global `~/.agemon/settings.json`. All plugins share one flat key space, there is no `setSetting`, no per-plugin isolation, no schema declaration, no secret masking, and no UI. This doesn't scale once real third-party plugins (Linear, OpenClaw, etc.) need API keys and configuration.

---

## Current State (verified against codebase)

| What | Where | State |
|------|-------|-------|
| `ctx.getSetting` | `loader.ts:156` | Directly passes global `getSetting` from `db/settings.ts` |
| `ctx.setSetting` | `types.ts:PluginContext` | **Missing** |
| `PluginManifest.settings` | `shared/types/plugin.ts` | **Missing** |
| Settings API routes | `mount.ts` | **Missing** |
| `configured` state | `LoadedPlugin` + `GET /api/plugins` | **Missing** |
| Plugin data dir | `loader.ts:147` | Already created at `~/.agemon/plugins/{id}/data/` |

---

## Design

Three layers: **Storage**, **Schema**, and **UI**. They can be shipped independently in that order — each is useful standalone.

---

### Layer 1 — Storage: per-plugin settings.json + env override

**File:** `~/.agemon/plugins/{pluginId}/data/settings.json`

```json
{ "apiKey": "lin_api_xxx", "projectId": "PRJ-123" }
```

No namespacing needed — each plugin's settings are already isolated by directory. The global `settings.json` (SQLite-backed) stays for core Agemon settings (theme, VAPID keys, nav toggles).

**`ctx.getSetting`** becomes:

```ts
// env var takes precedence (Docker/CI-friendly)
const envKey = `AGEMON_PLUGIN_${manifest.id.toUpperCase()}_${key.toUpperCase()}`;
return process.env[envKey] ?? readPluginSettings(pluginSettingsPath)[key] ?? null;
```

**`ctx.setSetting`** added:

```ts
ctx.setSetting = (key, value) => writePluginSetting(pluginSettingsPath, key, value);
```

Helpers `readPluginSettings` / `writePluginSetting` are simple JSON read/write using `Bun.file` + existing `atomicWriteSync`. No new dependencies.

**Env var override convention:** `AGEMON_PLUGIN_{PLUGIN_ID}_{KEY}` — checked at call time, not load time, so changes propagate without restart.

---

### Layer 2 — Schema: declare settings in the manifest

```json
{
  "id": "linear",
  "settings": [
    { "key": "apiKey",    "label": "API Key",    "type": "secret",  "required": true,
      "description": "Personal API key from Linear → Settings → API" },
    { "key": "projectId", "label": "Project ID", "type": "string",  "required": true },
    { "key": "teamId",    "label": "Team ID",    "type": "string",  "required": false }
  ]
}
```

**Types:** `string` | `secret` | `boolean` | `select` (with `options: string[]`).

**`secret` masking rule:** `GET /api/plugins/:id/settings` returns `"apiKey": "set"` (or `null`) — never the actual value. `POST` accepts the value and writes it. This applies to API responses only; `ctx.getSetting('apiKey')` on the server always returns the real value.

**`configured` state:** The plugin loader checks required settings after `onLoad`. If any required setting is missing (no stored value, no env var), the plugin is marked `configured: false`. The plugin still loads and registers routes — it just shouldn't wire event listeners it can't use:

```ts
// plugins/linear/index.ts
export async function onLoad(ctx: PluginContext): Promise<PluginExports> {
  const apiKey = ctx.getSetting('apiKey');
  if (!apiKey) {
    return { apiRoutes }; // settings UI still works, events won't fire
  }
  ctx.on('session:state_changed', handleStateChange);
  return { apiRoutes };
}
```

`configured` is surfaced in `GET /api/plugins` response so the frontend can show a "needs setup" badge.

---

### Layer 3 — UI: auto-generated form + optional custom renderer

**Default (auto-generated):** Host app reads `settings` schema from manifest, renders a generic form at `/settings/plugins/:id`. No plugin code needed for most cases.

API:
- `GET /api/plugins/:id/settings` → `{ key, label, type, required, description, value: string | "set" | null }[]`
- `POST /api/plugins/:id/settings` → `{ [key]: value }` body, writes all provided keys

**Override (custom settings renderer):** Plugin declares `settingsRenderer: "settings"` in manifest. Host loads the built component via the existing blob URL pattern (same as plugin pages). Useful for complex flows: OAuth, connection test button, multi-step wizard.

```json
{ "id": "openclaw", "settingsRenderer": "settings" }
```

```tsx
// plugins/openclaw/renderers/settings.tsx
export default function OpenClawSettings({ getSetting, setSetting, onSave }) {
  // Custom UI
}
```

This reuses the existing `renderers/` + `builtPages` builder pipeline — no new infrastructure.

---

## Route Ordering Constraint (important)

`mount.ts` has a catch-all `app.all('/api/plugins/:pluginId/*')` that delegates to plugin `apiRoutes`. In Hono, routes match in registration order. `GET /api/plugins/:id/settings` would be intercepted by this catch-all unless the settings routes are **registered before the catch-all**.

Current `mount.ts` order:
1. `app.all('/api/plugins/:pluginId/*')` — catch-all ← **settings routes must go before this**
2. `app.get('/api/plugins')` — list plugins
3. `app.patch('/api/plugins/:pluginId')` — nav toggle

After refactor, settings routes go before the catch-all:
1. `app.get('/api/plugins/:pluginId/settings')` ← new
2. `app.post('/api/plugins/:pluginId/settings')` ← new
3. `app.all('/api/plugins/:pluginId/*')` — catch-all (unchanged)
4. `app.get('/api/plugins')`
5. `app.patch('/api/plugins/:pluginId')`

---

## Changes Per File

| File | Change |
|------|--------|
| `shared/types/plugin.ts` | Add `PluginSettingSchema` type; add `settings?: PluginSettingSchema[]` and `settingsRenderer?: string` to `PluginManifest` |
| `backend/src/lib/plugins/types.ts` | Add `setSetting(key: string, value: string): void` to `PluginContext`; add `configured?: boolean` to `LoadedPlugin` |
| `backend/src/lib/plugins/loader.ts` | Add `readPluginSettings` / `writePluginSetting` helpers; swap `ctx.getSetting` to per-plugin + env override; add `ctx.setSetting`; compute and store `configured` after `onLoad` |
| `backend/src/lib/plugins/mount.ts` | Add `GET/POST /api/plugins/:id/settings` routes **before** catch-all; include `configured` in `GET /api/plugins` response |
| `backend/src/lib/plugins/builder.ts` | Build `settingsRenderer` component (same as existing renderer build path) |
| `frontend/src/routes/settings.tsx` (or new route) | Auto-generated settings form at `/settings/plugins/:id`; blob URL load for custom `settingsRenderer` |

---

## Sequencing Recommendation

These three layers are independent — each delivers value on its own:

1. **Layer 1 first** (Storage + `setSetting`) — unblocks any plugin that needs to store config. No UI needed; operators can edit the JSON file directly. Env var override makes Docker deploys work immediately.

2. **Layer 2** (Schema + `configured` state) — adds validation and the "needs setup" indicator. Unblocks the UI layer.

3. **Layer 3** (UI) — polish. The auto-generated form handles 90% of cases; the custom renderer is only needed for OAuth flows or complex setup wizards.

---

## What Does NOT Change

- Global `~/.agemon/settings.json` (SQLite-backed via `db/settings.ts`) — stays for core Agemon settings
- `PATCH /api/plugins/:id` nav toggle — stays in `mount.ts`, still uses global settings store
- Plugin load/build pipeline (`builder.ts`, `registry.ts`) — unchanged except builder gains `settingsRenderer` build
- EventBridge, `onLoad` signature — unchanged

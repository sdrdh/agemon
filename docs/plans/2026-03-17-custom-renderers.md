# Custom Renderers & Plugin Pages

## Problem

We want agents to be able to create new UI components at runtime that:
1. Can render custom message types in the chat
2. Can appear as full pages in the main app navigation

## Goals

- **Plugin-owned build** — each plugin has its own `package.json` and build script
- **Minimal infrastructure** — reuse existing plugin system
- **Agent-authored** — agent can create new renderers by writing files

## Architecture

### Plugin Build Pipeline

Each plugin with renderers:
1. Has a `package.json` with a `build` script
2. On server startup, the backend runs `bun install && bun run build` in the plugin directory
3. Build outputs browser-ready ESM JS to `dist/renderers/`
4. Backend caches and serves the built files

Externals (react, lucide-react) are resolved via `window.__AGEMON__`, which the host app populates in `main.tsx`. Plugins use a Bun.build plugin to map bare specifiers to these globals.

### Plugin Structure

```
plugins/memory-cms/
├── agemon-plugin.json      # manifest
├── package.json            # has "build" script
├── build.ts                # Bun.build with externals plugin
├── index.ts                # backend entry (server-side)
├── renderers/
│   └── memory-view.tsx     # source: chat renderer + page
└── dist/
    └── renderers/
        └── memory-view.js  # built output (gitignored)
```

### Plugin Exports

```typescript
// Plugin onLoad return
{
  renderers: [
    { manifest: { name: 'todo-list', messageType: 'todo-list' }, component: TodoList, dir: pluginDir }
  ],
  pages: [
    { path: '/todos', component: 'todo-list' }
  ]
}
```

### Backend Endpoints

```
GET /api/renderers/registry                          → list all renderers
GET /api/renderers/:name.js                          → get built renderer JS
GET /api/renderers/pages/registry                    → list plugin pages
GET /api/renderers/pages/:pluginId/:component.js     → get built page JS
GET /api/plugins                                     → list plugins (with navLabel/navIcon)
GET /api/memory/:taskId/:type                        → get task memory/summary content
```

### Frontend Integration

1. **Host globals**: `main.tsx` sets `window.__AGEMON__` with React, ReactDOM, jsxRuntime, LucideReact
2. **Chat renderers**: `ChatBubble` fetches the renderer registry once, then for non-builtin event types dynamically loads the matching component via `import('/api/renderers/{name}.js')`
3. **Plugin pages**: Route `/p/:pluginId/*` loads component via `import('/api/renderers/pages/{pluginId}/{component}.js')`
4. **Bottom nav**: Fetches `/api/plugins`, adds items with `navLabel` to nav

### How Plugins Build

Plugin build script uses `Bun.build` with an externals plugin:

```typescript
// build.ts
const agemonExternalsPlugin = {
  name: 'agemon-externals',
  setup(build) {
    const EXTERNAL_MAP = {
      'react': 'React',
      'react/jsx-runtime': 'jsxRuntime',
      'lucide-react': 'LucideReact',
    };
    // onResolve + onLoad: map bare specifiers to window.__AGEMON__.{name}
  },
};

await Bun.build({
  entrypoints: ['./renderers/memory-view.tsx'],
  outdir: './dist/renderers',
  format: 'esm',
  target: 'browser',
  plugins: [agemonExternalsPlugin],
});
```

Output is a self-contained ESM file where `import { useState } from "react"` becomes `const { useState } = window.__AGEMON__.React`. No import maps needed.

## Security Considerations

- Component paths validated (alphanumeric + hyphens only)
- Path traversal prevented in file lookups
- Components run in same-origin context (share cookies/auth)
- Built JS served with immutable cache headers + ETag
- Plugin build runs at server startup only (no runtime code execution)

## Future Enhancements

- Hot reload when plugin source changes (file watcher → rebuild)
- Plugin versioning and dependency management
- Shared component library for plugins (Tailwind classes, shadcn components)
- Plugin config UI (stored in DB)
- Publish reusable `@agemon/plugin-tools` package with the externals plugin

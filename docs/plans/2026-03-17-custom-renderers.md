# Custom Renderers & Plugin Pages

## Problem

We want agents to be able to create new UI components at runtime that:
1. Can render custom message types in the chat
2. Can appear as full pages in the main app navigation

## Goals

- **Runtime in dev, buildtime in prod** — Vite handles this naturally via dynamic imports
- **Minimal infrastructure** — reuse existing plugin system
- **Agent-authored** — agent can create new renderers by writing files

## Architecture

### Plugin Exports

Plugins can export `renderers` and `pages`:

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

### Component Location

Components live in `plugins/{pluginId}/renderers/{name}.tsx`:

```
plugins/memory-cms/
├── index.ts
├── agemon-plugin.json
└── renderers/
    ├── memory-view.tsx    # chat renderer + page component
    └── todo-list.tsx      # another component
```

### Backend Endpoints

```
GET /api/renderers/registry         → list all renderers
GET /api/renderers/:name.js         → get renderer TSX source
GET /api/renderers/pages/registry   → list plugin pages  
GET /api/renderers/pages/:pluginId/:component.js → get page component
GET /api/plugins                    → list plugins (with navLabel/navIcon)
```

### Frontend Integration

1. **Chat renderers**: `ChatBubble` checks if message.eventType matches a known custom renderer, then lazy-loads the component
2. **Plugin pages**: Route `/p/:pluginId/*` lazy-loads component and renders in app layout
3. **Bottom nav**: Fetches `/api/plugins`, adds items with `navLabel` to nav

### How Agents Create Renderers

1. Agent writes a `.tsx` file to `plugins/{pluginId}/renderers/`
2. File exports:
   ```tsx
   export const renderer = { manifest: { name: 'my-renderer', messageType: 'my-type' } };
   export default function MyRenderer({ message }) { ... }
   ```
3. Backend rescans on restart (or we can hot-reload)
4. Frontend dynamically loads it when needed

## Why This Approach

### Buildtime in Prod
Vite analyzes dynamic `import()` calls at build and bundles them. So in production, renderers are bundled with the app.

### Runtime in Dev  
In dev, Vite treats `import('/api/renderers/foo.js')` as a network request and serves the source file directly.

### Why Not Import Maps
Could use import maps to map names to URLs, but:
- More complex to set up
- Dynamic imports already work with Vite

### Why Not Web Components
Could have plugins export Web Components, but:
- React components are more familiar
- Share state easier with main app

## Usage Examples

### Creating a Chat Renderer

```tsx
// plugins/my-plugin/renderers/todo-list.tsx

export const renderer = {
  manifest: {
    name: 'todo-list',
    messageType: 'todo-list',
    label: 'Todo List',
    description: 'Renders a todo list in chat'
  }
};

interface TodoMessage {
  items: { text: string; done: boolean }[];
}

function TodoListRenderer({ message }: { message: TodoMessage }) {
  return (
    <div className="rounded-lg border p-3">
      {message.items.map((item, i) => (
        <div key={i} className={item.done ? 'line-through' : ''}>
          {item.text}
        </div>
      ))}
    </div>
  );
}

export default TodoListRenderer;
```

### Creating a Plugin Page

```tsx
// Same component can be used for both chat and page!

// plugins/my-plugin/renderers/dashboard.tsx
export const renderer = { manifest: { name: 'dashboard', messageType: 'dashboard' } };

export default function Dashboard() {
  return <div className="p-4"><h1>My Plugin Dashboard</h1></div>;
}

// In plugin index.ts:
export function onLoad(ctx) {
  return {
    pages: [
      { path: '/', component: 'dashboard' }  // /p/my-plugin/
    ]
  };
}
```

### Adding to Navigation

```json
// agemon-plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "navLabel": "My Plugin",
  "navIcon": "puzzle"
}
```

## Migration Path

Currently, plugins serve static HTML via `pageRoutes`. This new system provides React-based pages. 

- Keep both: static HTML for simple pages, React for interactive ones
- Eventually deprecate static HTML when all plugins migrate

## Security Considerations

- Component paths validated (alphanumeric + hyphens only)
- Path traversal prevented in file lookups
- Components run in same-origin context (share cookies/auth)
- No eval() — Vite transforms TSX to JS

## Future Enhancements

- Hot reload when plugins change (file watcher)
- Plugin versioning and dependency management
- Shared component library for plugins
- Plugin config UI (stored in DB)

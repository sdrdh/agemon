# Spike: Astro SSR + Plugin Frontend Unification

**Date:** 2026-03-17
**Status:** Parked — revisit after cookie auth + current plugin POC ships
**Context:** Discussion during plugin system POC (branch `feat/plugin-system-poc`)

---

## The Insight

If Astro becomes the frontend renderer, the plugin UI story simplifies dramatically:

- **Plugin = a JS module exporting components**, not a full app
- Astro SSR renders plugin components within the shared layout (nav, auth, theme)
- Plugin components can use `client:load` for interactivity (React islands)
- Cookie auth means no token passing — seamless navigation between main app and plugins
- WebSocket + Zustand available to any plugin island that needs real-time data

## Current Frontend (React SPA)

- React 18 + Vite 5 + TanStack Router + TanStack Query + Zustand
- WebSocket for real-time state (session events, approvals, etc.)
- Lazy-loaded xterm.js for terminal
- Chat UI with streaming messages
- Mobile-first bottom nav

## Proposed Architecture

```
frontend/ (Astro project)
├── src/
│   ├── layouts/
│   │   └── AppLayout.astro          # shared shell: header, bottom nav, auth
│   ├── pages/
│   │   ├── index.astro              # dashboard
│   │   ├── kanban.astro
│   │   ├── sessions.astro
│   │   ├── settings.astro
│   │   ├── tasks/[id].astro         # task detail
│   │   └── plugins/[...path].astro  # dynamic plugin route
│   ├── islands/                     # React client islands
│   │   ├── ChatPanel.tsx            # client:load — WebSocket, Zustand
│   │   ├── TerminalView.tsx         # client:load — xterm.js
│   │   ├── ApprovalCard.tsx         # client:load
│   │   └── ws-provider.tsx          # client:load — WebSocket connection
│   └── lib/
│       ├── ws.ts                    # WebSocket client (same as current)
│       └── store.ts                 # Zustand store (same as current)
├── astro.config.ts                  # SSR mode, Hono adapter
└── package.json
```

### Plugin Interface (target)

```typescript
// What a plugin builder ships as index.js
export default {
  pages: [
    {
      path: '/memory',
      label: 'Memories',
      icon: 'book-open',              // lucide icon name
      component: MemoryList,           // React component
      ssr: true,                       // server-render (default)
    },
    {
      path: '/memory/:taskId/:file',
      component: MemoryDetail,
      ssr: true,
    },
  ],
}
```

Astro's `plugins/[...path].astro` page:
1. Reads plugin registry
2. Matches the path to a plugin page
3. Imports the component
4. Renders within `AppLayout.astro` (shared nav, auth, theme)
5. If component needs client interactivity, wraps with `client:load`

### What Stays the Same
- WebSocket + Zustand for real-time state (React islands)
- TanStack Query for data fetching (inside islands)
- Same shadcn/ui components (work in Astro React islands)
- Cookie auth for all routes
- Hono backend serves Astro SSR output

### What Changes
- TanStack Router → Astro file-based routing (server-side)
- Full page renders are server-side (fast initial load, good for mobile)
- Client interactivity only where needed (islands)
- Plugin pages are first-class routes, not separate /p/ prefix

## Migration Path

1. Cookie auth (prerequisite — done in plugin POC branch)
2. Astro project setup with Hono SSR adapter
3. Port layout shell (header, bottom nav) to Astro
4. Port simple pages first (dashboard, kanban, sessions, settings)
5. Port complex pages as islands (task detail with chat, terminal)
6. Plugin dynamic routing via [...path].astro
7. Remove Vite + TanStack Router
8. Update build pipeline

## Risks

- **Astro + Hono SSR adapter maturity** — community adapter, not official. Need to validate it handles WebSocket upgrade correctly (Hono's upgradeWebSocket).
- **Island hydration cost** — chat page is essentially one big island. May not gain much from SSR there. But dashboard, kanban, settings, plugin pages all benefit.
- **Build time** — Astro build is slower than Vite. Dev mode HMR should still be fast.
- **TanStack Query in islands** — need to ensure QueryClient is shared across islands on the same page, or accept independent query caches per island.

## Decision Criteria

Pursue this if:
- Plugin ecosystem grows beyond 1-2 plugins (shared layout becomes essential)
- Mobile performance needs improvement (SSR initial load)
- The current /p/ full-page-navigation UX feels too disconnected

Skip if:
- Few plugins, and the Hono JSX approach is sufficient
- Dev velocity matters more than architectural purity

import { Suspense, Component, lazy, useState, useEffect, type ReactNode } from 'react';
import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  RouterProvider,
  Outlet,
  Link,
  useMatches,
} from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Home, TerminalSquare, Settings, Puzzle } from 'lucide-react';
import { hasApiKey, clearApiKey } from './lib/api';
import { connectWs, disconnectWs } from './lib/ws';
import { queryClient } from './lib/query';
import { useWsStore } from './lib/store';
import { WsProvider } from './components/custom/ws-provider';
import { ConnectionBanner } from './components/custom/connection-banner';
import { ThemeProvider } from './lib/theme-provider';

const IndexPage = lazy(() => import('./routes/index'));
const TaskDetailPage = lazy(() => import('./routes/tasks.$id'));
const SessionsPage = lazy(() => import('./routes/sessions'));
const SettingsPage = lazy(() => import('./routes/settings'));
const LoginScreen = lazy(() => import('./routes/login'));
const ProjectsPage = lazy(() => import('./routes/projects'));
const PluginPage = lazy(() => import('./routes/plugin'));

// ─── Router Context ──────────────────────────────────────────────────────────

interface RouterContext {
  onLogout: () => void;
}

// ─── Bottom Nav ──────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact: boolean;
}

const NAV_HOME: NavItem = { to: '/', label: 'Home', icon: Home, exact: true };
const NAV_SESSIONS: NavItem = { to: '/sessions', label: 'Sessions', icon: TerminalSquare, exact: false };
const NAV_END: NavItem = { to: '/settings', label: 'Settings', icon: Settings, exact: false };


/** Resolve a Lucide icon by name from the already-loaded window.__AGEMON__.LucideReact bundle. */
function resolveLucideIcon(name: string): React.ComponentType<{ className?: string }> {
  const lucide = (window as any).__AGEMON__?.LucideReact as Record<string, unknown> | undefined;
  const icon = lucide?.[name];
  // lucide-react v0.4xx exports icons as forwardRef objects, not plain functions
  return icon != null ? (icon as React.ComponentType<{ className?: string }>) : Puzzle;
}

/** Fetch a plugin's compiled icon component from the backend. */
async function fetchPluginIcon(pluginId: string): Promise<React.ComponentType<{ className?: string }>> {
  try {
    const res = await fetch(`/api/renderers/icons/${pluginId}.js`, { credentials: 'include' });
    if (!res.ok) return Puzzle;
    const code = await res.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const mod = await import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
    return (mod.default as React.ComponentType<{ className?: string }>) ?? Puzzle;
  } catch {
    return Puzzle;
  }
}

function BottomNav() {
  const matches = useMatches();
  const isTaskDetail = matches.some((m) => m.routeId === '/tasks/$id');
  const connected = useWsStore(s => s.connected);
  const updateAvailable = useWsStore(s => s.updateAvailable);
  const pluginsRevision = useWsStore(s => s.pluginsRevision);
  const [pluginNavItems, setPluginNavItems] = useState<NavItem[]>([]);

  // Refetch when WS reconnects (server restart) or when server signals plugins changed
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch('/api/plugins', { credentials: 'include', signal: controller.signal })
      .then(res => res.json())
      .then(async (plugins: { id: string; navEnabled: boolean; navItems: { label: string; lucideIcon?: string | null; icon?: string | null; path: string; order?: number }[] }[]) => {
        type SortedNavItem = NavItem & { order: number };
        const items: SortedNavItem[] = [];
        for (const p of plugins) {
          if (!p.navEnabled || !p.navItems?.length) continue;
          for (const ni of p.navItems) {
            const subPath = ni.path === '/' ? '' : ni.path;
            const icon = ni.lucideIcon
              ? resolveLucideIcon(ni.lucideIcon)
              : ni.icon ? await fetchPluginIcon(p.id) : Puzzle;
            items.push({
              to: `/p/${p.id}${subPath}`,
              label: ni.label,
              icon,
              exact: ni.path === '/',
              order: ni.order ?? 999,
            });
          }
        }
        items.sort((a, b) => a.order - b.order);
        return items;
      })
      .then(setPluginNavItems)
      .catch(err => { if (err.name !== 'AbortError') console.error(err); });
    return () => controller.abort();
  }, [connected, pluginsRevision]);

  if (isTaskDetail) return null;

  const navItems = [NAV_HOME, ...pluginNavItems, NAV_SESSIONS, NAV_END];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14 max-w-5xl mx-auto overflow-x-auto">
        {navItems.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-3 text-muted-foreground transition-colors shrink-0"
            activeProps={{
              className:
                'flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-3 text-primary transition-colors shrink-0',
            }}
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {to === '/settings' && updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </span>
            <span className="text-[10px] leading-tight">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ─── Root Route Layout ───────────────────────────────────────────────────────

function RootLayout() {
  const matches = useMatches();
  const isTaskDetail = matches.some((m) => m.routeId === '/tasks/$id');
  const isDashboard = matches.some((m) => m.routeId === '/' && m.pathname === '/');
  const connected = useWsStore(s => s.connected);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isTaskDetail && (
        <header className="sticky top-0 z-40 bg-background border-b">
          <div className="flex items-center justify-between h-11 px-4 max-w-5xl mx-auto">
            <Link to="/" className="text-base font-bold">
              Agemon
            </Link>
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-success' : 'bg-destructive'}`}
              aria-label={connected ? 'Connected' : 'Disconnected'}
            />
          </div>
        </header>
      )}
      {!isTaskDetail && !isDashboard && <ConnectionBanner />}
      <main className={isTaskDetail ? '' : 'pb-16 max-w-5xl mx-auto'}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/$id',
  component: TaskDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === 'string' ? search.session : undefined,
  }),
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === 'string' ? search.taskId : undefined,
  }),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
});

// Root of a plugin: /p/memory-cms
const pluginPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$pluginId',
  component: PluginPage,
});

// Sub-pages of a plugin: /p/memory-cms/foo/bar
const pluginSubPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$pluginId/$',
  component: PluginPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  taskDetailRoute,
  sessionsRoute,
  settingsRoute,
  projectsRoute,
  pluginPageRoute,
  pluginSubPageRoute,
]);

export const router = createRouter({
  routeTree,
  context: { onLogout: () => {} },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <p className="font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-sm underline text-primary"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SuspenseFallback = () => (
  <div role="status" aria-busy="true" className="min-h-screen bg-background p-4 space-y-4">
    <div className="h-10 w-1/3 rounded-md bg-muted animate-pulse" />
    <div className="h-40 rounded-md bg-muted animate-pulse" />
    <div className="h-40 rounded-md bg-muted animate-pulse" />
  </div>
);

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [authed, setAuthed] = useState(hasApiKey);

  function handleLogin() {
    connectWs();
    setAuthed(true);
  }

  function handleLogout() {
    disconnectWs();
    clearApiKey();
    setAuthed(false);
  }

  if (!authed) {
    return (
      <ThemeProvider>
        <ErrorBoundary>
          <Suspense fallback={<SuspenseFallback />}>
            <LoginScreen onLogin={handleLogin} />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Update router context with current handleLogout reference
  router.options.context.onLogout = handleLogout;

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <WsProvider>
            <Suspense fallback={<SuspenseFallback />}>
              <RouterProvider router={router} />
            </Suspense>
          </WsProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

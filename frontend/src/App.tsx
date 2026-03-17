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
import { Home, KanbanSquare, TerminalSquare, Settings, Puzzle, icons as lucideIcons } from 'lucide-react';
import { hasApiKey, clearApiKey } from './lib/api';
import { connectWs, disconnectWs } from './lib/ws';
import { queryClient } from './lib/query';
import { useWsStore } from './lib/store';
import { WsProvider } from './components/custom/ws-provider';
import { ConnectionBanner } from './components/custom/connection-banner';
import { ThemeProvider } from './lib/theme-provider';

const IndexPage = lazy(() => import('./routes/index'));
const TaskCreatePage = lazy(() => import('./routes/tasks.new'));
const TaskDetailPage = lazy(() => import('./routes/tasks.$id'));
const KanbanPage = lazy(() => import('./routes/kanban'));
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

const NAV_START: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, exact: true },
  { to: '/kanban', label: 'Kanban', icon: KanbanSquare, exact: false },
  { to: '/sessions', label: 'Sessions', icon: TerminalSquare, exact: false },
];
const NAV_END: NavItem = { to: '/settings', label: 'Settings', icon: Settings, exact: false };

/** Resolve a lucide icon name (kebab-case like "brain" or PascalCase like "Brain") to a component. */
function getIconByName(name: string | undefined): React.ComponentType<{ className?: string }> {
  if (!name) return Puzzle;
  // Try PascalCase first (e.g. "Brain"), then convert kebab-case (e.g. "brain" → "Brain", "arrow-left" → "ArrowLeft")
  const pascal = name.includes('-')
    ? name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    : name.charAt(0).toUpperCase() + name.slice(1);
  return (lucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[pascal] ?? Puzzle;
}

function BottomNav() {
  const matches = useMatches();
  const isTaskDetail = matches.some((m) => m.routeId === '/tasks/$id');
  const updateAvailable = useWsStore(s => s.updateAvailable);
  const [pluginNavItems, setPluginNavItems] = useState<NavItem[]>([]);

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then(res => res.json())
      .then((plugins: { id: string; navLabel: string | null; navIcon: string | null }[]) => {
        const items: NavItem[] = [];
        for (const p of plugins) {
          if (p.navLabel) {
            items.push({
              to: `/p/${p.id}`,
              label: p.navLabel,
              icon: getIconByName(p.navIcon ?? undefined),
              exact: true,
            });
          }
        }
        setPluginNavItems(items);
      })
      .catch(console.error);
  }, []);

  if (isTaskDetail) return null;

  const navItems = [...NAV_START, ...pluginNavItems, NAV_END];

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

const taskNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/new',
  component: TaskCreatePage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/$id',
  component: TaskDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === 'string' ? search.session : undefined,
  }),
});

const kanbanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kanban',
  component: KanbanPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsPage,
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
  taskNewRoute,
  taskDetailRoute,
  kanbanRoute,
  sessionsRoute,
  settingsRoute,
  projectsRoute,
  pluginPageRoute,
  pluginSubPageRoute,
]);

const router = createRouter({
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

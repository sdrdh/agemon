import { Suspense, Component, lazy, useState, type ReactNode } from 'react';
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
import { Home, KanbanSquare, TerminalSquare, Settings } from 'lucide-react';
import { hasApiKey, clearApiKey } from './lib/api';
import { connectWs, disconnectWs } from './lib/ws';
import { queryClient } from './lib/query';
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

// ─── Router Context ──────────────────────────────────────────────────────────

interface RouterContext {
  onLogout: () => void;
}

// ─── Bottom Nav ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/' as const, label: 'Tasks', icon: Home, exact: true },
  { to: '/kanban' as const, label: 'Kanban', icon: KanbanSquare, exact: false },
  { to: '/sessions' as const, label: 'Sessions', icon: TerminalSquare, exact: false },
  { to: '/settings' as const, label: 'Settings', icon: Settings, exact: false },
] as const;

function BottomNav() {
  const matches = useMatches();
  const isTaskDetail = matches.some((m) => m.routeId === '/tasks/$id');
  if (isTaskDetail) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14 max-w-5xl mx-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-3 text-muted-foreground transition-colors"
            activeProps={{
              className:
                'flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-3 text-primary transition-colors',
            }}
          >
            <Icon className="h-5 w-5" />
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isTaskDetail && (
        <header className="sticky top-0 z-40 bg-background border-b">
          <div className="flex items-center h-11 px-4 max-w-5xl mx-auto">
            <Link to="/" className="text-base font-bold">
              Agemon
            </Link>
          </div>
        </header>
      )}
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  taskNewRoute,
  taskDetailRoute,
  kanbanRoute,
  sessionsRoute,
  settingsRoute,
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
            <ConnectionBanner />
            <Suspense fallback={<SuspenseFallback />}>
              <RouterProvider router={router} />
            </Suspense>
          </WsProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

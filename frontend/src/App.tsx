import { Suspense, Component, lazy, useState, type ReactNode } from 'react';
import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  RouterProvider,
  Outlet,
  Link,
} from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Button } from './components/ui/button';
import { hasApiKey, clearApiKey } from './lib/api';
import { connectWs, disconnectWs } from './lib/ws';
import { queryClient } from './lib/query';
import { WsProvider } from './components/custom/ws-provider';

const IndexPage = lazy(() => import('./routes/index'));
const TaskCreatePage = lazy(() => import('./routes/tasks.new'));
const TaskDetailPage = lazy(() => import('./routes/tasks.$id'));
const KanbanPage = lazy(() => import('./routes/kanban'));
const SessionsPage = lazy(() => import('./routes/sessions'));
const LoginScreen = lazy(() => import('./routes/login'));

// ─── Router Context ──────────────────────────────────────────────────────────

interface RouterContext {
  onLogout: () => void;
}

// ─── Nav Bar ─────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { to: '/' as const, label: 'Tasks' },
  { to: '/kanban' as const, label: 'Kanban' },
  { to: '/sessions' as const, label: 'Sessions' },
];

function NavBar({ onLogout }: { onLogout: () => void }) {
  return (
    <nav className="sticky top-0 z-50 bg-background border-b">
      <div className="flex items-center h-12 px-4 gap-1">
        <Link
          to="/"
          className="text-base font-bold mr-4 min-h-[44px] flex items-center px-1"
        >
          Agemon
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto flex-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeOptions={{ exact: link.to === '/' }}
              className="text-sm text-muted-foreground min-h-[44px] min-w-[44px] flex items-center px-3 rounded-md transition-colors hover:text-foreground hover:bg-accent/50 whitespace-nowrap"
              activeProps={{
                className:
                  'text-sm text-foreground font-medium min-h-[44px] min-w-[44px] flex items-center px-3 rounded-md bg-accent whitespace-nowrap',
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="ml-auto min-h-[44px] min-w-[44px] text-xs text-muted-foreground flex-shrink-0"
        >
          Logout
        </Button>
      </div>
    </nav>
  );
}

// ─── Root Route Layout ───────────────────────────────────────────────────────

function RootLayout() {
  const { onLogout } = rootRoute.useRouteContext();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar onLogout={onLogout} />
      <Outlet />
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  taskNewRoute,
  taskDetailRoute,
  kanbanRoute,
  sessionsRoute,
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
      <ErrorBoundary>
        <Suspense fallback={<SuspenseFallback />}>
          <LoginScreen onLogin={handleLogin} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // Update router context with current handleLogout reference
  router.options.context.onLogout = handleLogout;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WsProvider>
          <Suspense fallback={<SuspenseFallback />}>
            <RouterProvider router={router} />
          </Suspense>
        </WsProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

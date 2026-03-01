import { Suspense, Component, lazy, useState, type ReactNode } from 'react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { hasApiKey, clearApiKey } from './lib/api';
import { connectWs, disconnectWs } from './lib/ws';

const IndexPage = lazy(() => import('./routes/index'));
const TaskCreatePage = lazy(() => import('./routes/tasks.new'));
const TaskDetailPage = lazy(() => import('./routes/tasks.$id'));
const LoginScreen = lazy(() => import('./routes/login'));

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  ),
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

const routeTree = rootRoute.addChildren([indexRoute, taskNewRoute, taskDetailRoute]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

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
            <p className="text-sm text-muted-foreground">{this.state.error?.message ?? 'An unexpected error occurred.'}</p>
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

  return (
    <ErrorBoundary>
      <Suspense fallback={<SuspenseFallback />}>
        <div className="relative">
          <button
            onClick={handleLogout}
            className="absolute top-3 right-3 z-50 text-xs text-muted-foreground underline"
          >
            Logout
          </button>
          <RouterProvider router={router} />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}

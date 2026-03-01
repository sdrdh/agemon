import { Suspense, Component, lazy, useState, type ReactNode } from 'react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { hasApiKey } from './lib/api';
import { connectWs } from './lib/ws';

const IndexPage = lazy(() => import('./routes/index'));
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

const routeTree = rootRoute.addChildren([indexRoute]);

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
          <div className="text-center space-y-2">
            <p className="font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground">An unexpected error occurred. Please refresh.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SuspenseFallback = () => (
  <div className="min-h-screen bg-background p-4 space-y-4">
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
        <RouterProvider router={router} />
      </Suspense>
    </ErrorBoundary>
  );
}

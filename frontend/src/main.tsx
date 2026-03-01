import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose } from './components/ui/toast';
import { showToast, onToast, type ToastPayload } from './lib/toast';
import { connectWs } from './lib/ws';
import { hasApiKey } from './lib/api';
import './index.css';
import App from './App.tsx';

function GlobalToast() {
  const [toasts, setToasts] = useState<(ToastPayload & { id: number })[]>([]);

  useEffect(() => {
    return onToast((payload) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...payload, id }]);
    });
  }, []);

  return (
    <>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          onOpenChange={(open) => {
            if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
          defaultOpen
        >
          <div className="grid gap-1">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
    </>
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      showToast({ title: 'Request failed', description: String(error.message), variant: 'destructive' });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      showToast({ title: 'Request failed', description: String(error.message), variant: 'destructive' });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
});

// Only connect if a key is already stored — login screen handles the first-time case.
if (hasApiKey()) connectWs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
        <GlobalToast />
        <ToastViewport />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

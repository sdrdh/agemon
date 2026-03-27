import * as React from 'react';
import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import * as jsxRuntimeProd from 'react/jsx-runtime';
import * as jsxRuntimeDev from 'react/jsx-dev-runtime';
import * as LucideReact from 'lucide-react';

// Merge prod + dev runtimes so plugins can use either jsx/jsxs (prod) or jsxDEV (dev)
const jsxRuntime = { ...jsxRuntimeProd, ...jsxRuntimeDev };
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose } from './components/ui/toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/ui/accordion';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Switch } from './components/ui/switch';
import { Textarea } from './components/ui/textarea';
import { onToast, type ToastPayload } from './lib/toast';
import { connectWs, subscribeWsEvent } from './lib/ws';
import { hasApiKey, api } from './lib/api';
import { useWsStore } from './lib/store';
import { formatDuration, formatMs } from './lib/time-utils';
import { PluginKitContext } from './lib/plugin-kit-context';
import { SessionList } from './components/custom/session-list';
import { ChatPanel } from './components/custom/chat-panel';
import { StatusBadge } from './components/custom/status-badge';
import { DiffViewer } from './components/custom/diff-viewer';
import { FileTreeViewer } from './components/custom/file-tree-viewer';
import { McpServerList } from './components/custom/mcp-server-list';
import './index.css';
import App, { router } from './App.tsx';

// Expose shared modules for plugin renderers.
// Plugin builds externalize react/lucide-react and reference window.__AGEMON__.
(window as any).__AGEMON__ = {
  React,
  ReactDOM,
  jsxRuntime,
  LucideReact,
  /** Navigate to a route using TanStack Router. */
  navigate: (opts: Parameters<typeof router.navigate>[0]) => router.navigate(opts),
  /** All shadcn/ui components — import via `window.__AGEMON__.ui` or declare as `@agemon/ui` external. */
  ui: {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger,
    Badge,
    Button,
    Card, CardContent, CardHeader, CardTitle,
    Input,
    Label,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    Switch,
    Textarea,
  },
  /** Utility helpers. */
  utils: { formatDuration, formatMs },
  /** API client — same instance used by the host app. */
  api,
  /** Subscribe to WebSocket server events. Returns an unsubscribe function. */
  onWsEvent: (handler: (event: unknown) => void) => subscribeWsEvent(handler),
  /** Control host chrome visibility. Call with 'fullscreen' to hide header+nav, 'default' to restore. */
  setHostLayout: (layout: 'default' | 'fullscreen') => useWsStore.getState().setHostLayout(layout),
  /** The React context object — plugins call useContext(window.__AGEMON__.PluginKitContext). */
  PluginKitContext,
  /** Host component kit — plugins import from '@agemon/host' which resolves to window.__AGEMON__.host. */
  host: { SessionList, ChatPanel, StatusBadge, DiffViewer, FileTreeViewer, McpServerList },
};

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

// Only connect if a key is already stored — login screen handles the first-time case.
if (hasApiKey()) connectWs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
      <GlobalToast />
      <ToastViewport />
    </ToastProvider>
  </StrictMode>,
);

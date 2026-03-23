import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PluginKitContext } from '@/lib/plugin-kit-context';
import { SessionList } from '@/components/custom/session-list';
import { ChatPanel } from '@/components/custom/chat-panel';
import { StatusBadge } from '@/components/custom/status-badge';
import type { PluginKit } from '../../../shared/types/plugin-kit';

async function fetchBuildError(pluginId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/plugins', { credentials: 'include' });
    if (!res.ok) return null;
    const plugins = await res.json() as Array<{ id: string; buildError?: string | null }>;
    return plugins.find(p => p.id === pluginId)?.buildError ?? null;
  } catch {
    return null;
  }
}

// Cast StatusBadge so its concrete TaskStatus prop satisfies the PluginKit's string-typed interface.
const StatusBadgeForKit = StatusBadge as PluginKit['StatusBadge'];

const pluginKit: PluginKit = {
  SessionList,
  ChatPanel,
  StatusBadge: StatusBadgeForKit,
};

export default function PluginPage() {
  // Route is /p/$pluginId/* — TanStack Router gives { pluginId, _splat }
  const params = useParams({ strict: false }) as { pluginId?: string; _splat?: string };
  const pluginId = params.pluginId ?? '';
  const pagePath = params._splat ?? '';

  const [Component, setComponent] = useState<React.ComponentType<unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  useEffect(() => {
    if (!pluginId) return;

    setLoading(true);
    setComponent(null);
    setError(null);

    const controller = new AbortController();
    const url = `/api/renderers/pages/${pluginId}/page.js?path=${encodeURIComponent(pagePath)}`;

    fetch(url, { credentials: 'include', signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((code) => {
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        return import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
      })
      .then((mod) => {
        setComponent(() => mod.default);
        setLoading(false);
      })
      .catch(async (err) => {
        if (err.name === 'AbortError') return;
        console.error(`Failed to load plugin page ${pluginId}/${pagePath}:`, err);
        const be = await fetchBuildError(pluginId);
        setBuildError(be);
        setError('Failed to load page');
        setLoading(false);
      });

    return () => controller.abort();
  }, [pluginId, pagePath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error || !Component) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-destructive text-sm font-medium">{error || 'Page not found'}</p>
        {buildError && (
          <pre className="text-xs text-muted-foreground bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {buildError}
          </pre>
        )}
      </div>
    );
  }

  return (
    <PluginKitContext.Provider value={pluginKit}>
      <Component />
    </PluginKitContext.Provider>
  );
}

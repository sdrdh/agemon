import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';

export default function PluginPage() {
  // Route is /p/$pluginId/* — TanStack Router gives { pluginId, _splat }
  const params = useParams({ strict: false }) as { pluginId?: string; _splat?: string };
  const pluginId = params.pluginId ?? '';
  const pagePath = params._splat ?? '';

  const [Component, setComponent] = useState<React.ComponentType<unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pluginId) return;

    setLoading(true);
    setComponent(null);
    setError(null);

    // Fetch built JS from backend, create a blob URL, and dynamic-import it
    const url = `/api/renderers/pages/${pluginId}/page.js?path=${encodeURIComponent(pagePath)}`;
    fetch(url, { credentials: 'include' })
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
      .catch((err) => {
        console.error('Failed to load plugin page:', err);
        setError('Failed to load page');
        setLoading(false);
      });
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
      <div className="flex items-center justify-center h-full p-8">
        <span className="text-destructive">{error || 'Page not found'}</span>
      </div>
    );
  }

  return <Component />;
}

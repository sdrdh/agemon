import { useEffect, useState, useRef } from 'react';
import { useParams } from '@tanstack/react-router';

export default function PluginPage() {
  const { id } = useParams({ strict: false }) as { id?: string; pluginId?: string; 0?: string; 1?: string; 2?: string; 3?: string; 4?: string };
  
  // Support both /p/:id and /p/:pluginId/* patterns
  const pluginId = id ?? '';
  
  // Build path from remaining params (for catch-all routes)
  const pathParts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const p = (i === 0 ? id : undefined) as unknown as string | undefined;
    if (p && p !== pluginId) pathParts.push(p);
  }
  const pagePath = pathParts.join('/') || '';
  
  const [Component, setComponent] = useState<React.ComponentType<unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || !pluginId) return;
    loadedRef.current = true;

    const componentName = pagePath || 'index';

    import(/* @vite-ignore */ `/api/renderers/pages/${pluginId}/${componentName}.js`)
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
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error || !Component) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive">{error || 'Page not found'}</span>
      </div>
    );
  }

  return <Component />;
}

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Puzzle } from 'lucide-react';
import { STORAGE_KEY } from '@/lib/api';

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  hasPages: boolean;
}

async function fetchPlugins(): Promise<PluginInfo[]> {
  const key = localStorage.getItem(STORAGE_KEY) ?? '';
  const res = await fetch('/api/plugins', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error('Failed to fetch plugins');
  return res.json();
}

export default function PluginsPage() {
  const { data: plugins, isLoading, error } = useQuery({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
  });

  return (
    <div className="px-4 py-4">
      <h1 className="text-lg font-semibold mb-4">Plugins</h1>

      {isLoading && (
        <div className="space-y-3">
          <div className="h-16 rounded-lg bg-muted animate-pulse" />
          <div className="h-16 rounded-lg bg-muted animate-pulse" />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Failed to load plugins: {(error as Error).message}
        </p>
      )}

      {plugins && plugins.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Puzzle className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No plugins installed</p>
          <p className="text-xs mt-1">
            Drop a plugin folder into ~/.agemon/plugins/ and restart
          </p>
        </div>
      )}

      {plugins && plugins.length > 0 && (
        <ul className="space-y-2">
          {plugins.map((p) => (
            <li key={p.id}>
              {p.hasPages ? (
                <a
                  href={`/p/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 bg-card rounded-lg border hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-xs">{p.version}</span>
                    <ExternalLink className="h-4 w-4" />
                  </div>
                </a>
              ) : (
                <div className="flex items-center justify-between px-4 py-3 bg-card rounded-lg border">
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{p.version}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

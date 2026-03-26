import { useEffect, useRef, useState, useCallback } from 'react';
import type { InputExtensionManifest } from '@agemon/shared';

// Props that the host passes into each extension component
export interface InputExtensionProps {
  onInsert: (text: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  connected: boolean;
  sessionState: string;
}

export interface LoadedExtension {
  pluginId: string;
  ext: InputExtensionManifest;
  /** null = not yet loaded or loading */
  component: React.ComponentType<InputExtensionProps> | null;
}

interface PluginApiEntry {
  id: string;
  inputExtensions: InputExtensionManifest[];
}

export function useInputExtensions(): {
  extensions: LoadedExtension[];
  loadExtension: (pluginId: string, extId: string) => Promise<void>;
} {
  const [extensions, setExtensions] = useState<LoadedExtension[]>([]);
  // Cache of already-loaded components keyed by "pluginId:extId"
  const loadedCache = useRef<Map<string, React.ComponentType<InputExtensionProps>>>(new Map());
  // Stable ref so loadExtension doesn't need extensions in its dep array
  const extensionsRef = useRef<LoadedExtension[]>([]);
  useEffect(() => { extensionsRef.current = extensions; }, [extensions]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/extensions', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<PluginApiEntry[]> : [])
      .then((plugins) => {
        if (cancelled) return;
        const exts: LoadedExtension[] = [];
        for (const p of plugins) {
          for (const ext of p.inputExtensions ?? []) {
            const cacheKey = `${p.id}:${ext.id}`;
            exts.push({
              pluginId: p.id,
              ext,
              component: loadedCache.current.get(cacheKey) ?? null,
            });
          }
        }
        setExtensions(exts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadExtension = useCallback(async (pluginId: string, extId: string) => {
    const cacheKey = `${pluginId}:${extId}`;
    if (loadedCache.current.has(cacheKey)) return;

    const ext = extensionsRef.current.find(e => e.pluginId === pluginId && e.ext.id === extId);
    if (!ext) return;

    const url = `/api/renderers/pages/${pluginId}/${ext.ext.component}.js`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const code = await res.text();
      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const mod = await import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
      const component = mod.default as React.ComponentType<InputExtensionProps>;
      loadedCache.current.set(cacheKey, component);
      setExtensions(prev =>
        prev.map(e => e.pluginId === pluginId && e.ext.id === extId ? { ...e, component } : e)
      );
    } catch (err) {
      console.error(`Failed to load input extension ${pluginId}/${extId}:`, err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads extensionsRef, not extensions state

  return { extensions, loadExtension };
}

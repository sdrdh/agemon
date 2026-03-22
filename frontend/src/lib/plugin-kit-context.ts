import { createContext, useContext } from 'react';
import type { PluginKit } from '../../../shared/types/plugin-kit';

/**
 * React context that exposes host components to plugin pages.
 * Provided by the PluginKitContext.Provider in plugin.tsx.
 * Phase 2 will populate the value with real components.
 */
export const PluginKitContext = createContext<PluginKit | null>(null);

/**
 * Hook for plugin pages to access host components.
 * Throws if called outside of a PluginKitContext.Provider.
 */
export function usePluginKit(): PluginKit {
  const kit = useContext(PluginKitContext);
  if (kit === null) {
    throw new Error('usePluginKit must be used within a PluginKitContext.Provider');
  }
  return kit;
}

import type { LoadedPlugin } from './types.ts';

let _plugins: LoadedPlugin[] = [];

export function setPlugins(plugins: LoadedPlugin[]): void {
  _plugins = plugins;
}

export function getPlugins(): LoadedPlugin[] {
  return _plugins;
}

export function getPlugin(id: string): LoadedPlugin | undefined {
  return _plugins.find(p => p.manifest.id === id);
}

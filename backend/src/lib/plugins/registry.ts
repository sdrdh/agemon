import type { LoadedPlugin, CustomRenderer, PluginPage } from './types.ts';
import type { CustomRendererManifest, PluginManifest } from '@agemon/shared';

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

export interface NavPlugin {
  id: string;
  name: string;
  navLabel: string;
  navIcon?: string;
}

export function getNavPlugins(): NavPlugin[] {
  const nav: NavPlugin[] = [];
  for (const plugin of _plugins) {
    if (plugin.manifest.navLabel) {
      nav.push({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        navLabel: plugin.manifest.navLabel,
        navIcon: plugin.manifest.navIcon,
      });
    }
  }
  return nav;
}

export function getAllRenderers(): CustomRenderer[] {
  const renderers: CustomRenderer[] = [];
  for (const plugin of _plugins) {
    if (plugin.exports.renderers) {
      for (const r of plugin.exports.renderers) {
        renderers.push({ ...r, dir: plugin.dir });
      }
    }
  }
  return renderers;
}

export function getRendererByMessageType(messageType: string): (CustomRenderer & { dir: string }) | undefined {
  for (const plugin of _plugins) {
    if (plugin.exports.renderers) {
      const found = plugin.exports.renderers.find(r => r.manifest.messageType === messageType);
      if (found) return { ...found, dir: plugin.dir };
    }
  }
  return undefined;
}

export interface PluginPageExport {
  pluginId: string;
  path: string;
  componentName: string;
  dir: string;
}

export function getAllPages(): PluginPageExport[] {
  const pages: PluginPageExport[] = [];
  for (const plugin of _plugins) {
    if (plugin.exports.pages) {
      for (const page of plugin.exports.pages) {
        pages.push({
          pluginId: plugin.manifest.id,
          path: page.path,
          componentName: page.component,
          dir: plugin.dir,
        });
      }
    }
  }
  return pages;
}

export function getPluginPage(pluginId: string, pagePath: string): (PluginPageExport) | undefined {
  const plugin = getPlugin(pluginId);
  if (!plugin?.exports.pages) return undefined;
  
  const page = plugin.exports.pages.find(p => p.path === pagePath);
  if (!page) return undefined;
  
  return {
    pluginId: plugin.manifest.id,
    path: page.path,
    componentName: page.component,
    dir: plugin.dir,
  };
}

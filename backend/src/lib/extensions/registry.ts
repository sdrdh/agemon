import type { LoadedExtension, CustomRenderer, ExtensionPage } from './types.ts';
import type { CustomRendererManifest, ExtensionManifest } from '@agemon/shared';

let _extensions: LoadedExtension[] = [];

export function setExtensions(extensions: LoadedExtension[]): void {
  _extensions = extensions;
}

export function getExtensions(): LoadedExtension[] {
  return _extensions;
}

export function getExtension(id: string): LoadedExtension | undefined {
  return _extensions.find(e => e.manifest.id === id);
}


export function getAllRenderers(): CustomRenderer[] {
  const renderers: CustomRenderer[] = [];
  for (const ext of _extensions) {
    if (ext.exports.renderers) {
      for (const r of ext.exports.renderers) {
        renderers.push({ ...r, dir: ext.dir });
      }
    }
  }
  return renderers;
}

export function getRendererByMessageType(messageType: string): (CustomRenderer & { dir: string }) | undefined {
  for (const ext of _extensions) {
    if (ext.exports.renderers) {
      const found = ext.exports.renderers.find(r => r.manifest.messageType === messageType);
      if (found) return { ...found, dir: ext.dir };
    }
  }
  return undefined;
}

export interface ExtensionPageExport {
  extensionId: string;
  path: string;
  componentName: string;
  dir: string;
}


export function getAllPages(): ExtensionPageExport[] {
  const pages: ExtensionPageExport[] = [];
  for (const ext of _extensions) {
    if (ext.exports.pages) {
      for (const page of ext.exports.pages) {
        pages.push({
          extensionId: ext.manifest.id,
          path: page.path,
          componentName: page.component,
          dir: ext.dir,
        });
      }
    }
  }
  return pages;
}

export function getExtensionPage(extensionId: string, pagePath: string): ExtensionPageExport | undefined {
  const ext = getExtension(extensionId);
  if (!ext?.exports.pages) return undefined;

  // Exact match first, then fall back to root '/' for SPA-style extensions
  const page =
    ext.exports.pages.find(p => p.path === pagePath) ??
    ext.exports.pages.find(p => p.path === '/');
  if (!page) return undefined;

  return {
    extensionId: ext.manifest.id,
    path: page.path,
    componentName: page.component,
    dir: ext.dir,
  };
}


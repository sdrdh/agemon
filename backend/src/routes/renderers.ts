import { Hono } from 'hono';
import { getAllRenderers, getRendererByMessageType, getAllPages, getPluginPage } from '../lib/plugins/registry.ts';
import { getBuiltRenderer, getBuiltPage, buildPluginRenderers } from '../lib/plugins/builder.ts';

const renderers = new Hono();

renderers.get('/registry', (c) => {
  const allRenderers = getAllRenderers();
  return c.json({
    renderers: allRenderers.map(r => r.manifest),
  });
});

renderers.get('/:messageType.js', async (c) => {
  const messageType = c.req.param('messageType') ?? '';

  if (!/^[a-zA-Z0-9-]+$/.test(messageType)) {
    return c.text('Invalid renderer name', 400);
  }

  const renderer = getRendererByMessageType(messageType);
  if (!renderer) {
    return c.text('Renderer not found', 404);
  }

  const built = getBuiltRenderer(messageType);
  if (!built) {
    return c.text('Renderer not built — restart server', 404);
  }

  return c.body(built.code, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'ETag': `"${built.hash}"`,
    },
  });
});

// Plugin pages registry
renderers.get('/pages/registry', (c) => {
  const pages = getAllPages();
  return c.json({
    pages: pages.map(p => ({
      pluginId: p.pluginId,
      path: p.path,
    })),
  });
});

// Serve plugin page component — resolves URL path → component → built JS
// e.g. GET /pages/memory-cms/page.js         → path "/" (root)
//      GET /pages/memory-cms/page.js?path=foo → path "/foo"
renderers.get('/pages/:pluginId/page.js', async (c) => {
  const pluginId = c.req.param('pluginId') ?? '';
  const pathParam = c.req.query('path') ?? '';

  if (!/^[a-zA-Z0-9-]+$/.test(pluginId)) {
    return c.text('Invalid plugin ID', 400);
  }

  // Resolve "/" for root, "/foo" for subpaths
  const pagePath = '/' + pathParam;
  const page = getPluginPage(pluginId, pagePath);
  if (!page) {
    return c.text(`Page not found: ${pagePath}`, 404);
  }

  const built = getBuiltPage(pluginId, page.componentName);
  if (!built) {
    return c.text('Component not built — restart server', 404);
  }

  return c.body(built.code, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'ETag': `"${built.hash}"`,
    },
  });
});

export const renderersRoutes = renderers;

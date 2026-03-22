import { Hono } from 'hono';
import { getAllRenderers, getRendererByMessageType, getAllPages, getPluginPage } from '../lib/plugins/registry.ts';
import { getBuiltRenderer, getBuiltPage, getBuiltIcon, buildPluginRenderers } from '../lib/plugins/builder.ts';

const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const;

const renderers = new Hono();

renderers.get('/registry', (c) => {
  const allRenderers = getAllRenderers();
  return c.json({
    renderers: allRenderers.map(r => r.manifest),
  });
});

renderers.get('/:filename', async (c) => {
  const filename = c.req.param('filename') ?? '';
  if (!filename.endsWith('.js')) return c.text('Not found', 404);
  const messageType = filename.slice(0, -3);

  if (!/^[a-zA-Z0-9-]+$/.test(messageType)) {
    return c.text('Invalid renderer name', 400);
  }

  const renderer = getRendererByMessageType(messageType);
  if (!renderer) {
    return c.text('Renderer not found', 404);
  }

  const built = getBuiltRenderer(messageType);
  if (!built) {
    return c.text('Renderer not built or hot-reload in progress — check server logs for build errors', 503);
  }

  return c.body(built.code, {
    headers: { ...JS_HEADERS, 'ETag': `"${built.hash}"` },
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

  // Sanitize path — strip traversal segments before registry lookup
  const safePath = pathParam
    .split('/')
    .filter(s => s && s !== '.' && s !== '..')
    .join('/');
  const pagePath = '/' + safePath;

  const page = getPluginPage(pluginId, pagePath);
  if (!page) {
    return c.text(`Page not found: ${pagePath}`, 404);
  }

  const built = getBuiltPage(pluginId, page.componentName);
  if (!built) {
    return c.text('Component not built or hot-reload in progress — check server logs for build errors', 503);
  }

  return c.body(built.code, {
    headers: { ...JS_HEADERS, 'ETag': `"${built.hash}"` },
  });
});

// Serve any built plugin component by name (used by input extensions and future generic slots)
// e.g. GET /pages/voice-input/voice-input.js
renderers.get('/pages/:pluginId/:filename', async (c) => {
  const pluginId = c.req.param('pluginId') ?? '';
  const filename = c.req.param('filename') ?? '';
  if (!filename.endsWith('.js')) return c.text('Not found', 404);
  const component = filename.slice(0, -3);

  if (!/^[a-zA-Z0-9-]+$/.test(pluginId) || !/^[a-zA-Z0-9-]+$/.test(component)) {
    return c.text('Invalid parameters', 400);
  }

  const built = getBuiltPage(pluginId, component);
  if (!built) {
    return c.text('Component not built — check server logs for build errors', 404);
  }

  return c.body(built.code, {
    headers: { ...JS_HEADERS, 'ETag': `"${built.hash}"` },
  });
});

// Serve plugin nav icon component
renderers.get('/icons/:filename', async (c) => {
  const filename = c.req.param('filename') ?? '';
  if (!filename.endsWith('.js')) return c.text('Not found', 404);
  const pluginId = filename.slice(0, -3);

  if (!/^[a-zA-Z0-9-]+$/.test(pluginId)) {
    return c.text('Invalid plugin ID', 400);
  }

  const built = getBuiltIcon(pluginId);
  if (!built) {
    return c.text('Icon not found', 404);
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

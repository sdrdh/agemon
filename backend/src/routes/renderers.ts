import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getAllRenderers, getRendererByMessageType, getAllPages, getPluginPage } from '../lib/plugins/registry.ts';

function agemonDir(): string {
  return process.env.AGEMON_DIR ? resolve(process.env.AGEMON_DIR) : join(homedir(), '.agemon');
}

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

  // Look up the renderer component in the plugin's renderers directory
  const pluginDir = renderer.dir;
  const componentPath = join(pluginDir, 'renderers', `${messageType}.tsx`);
  
  try {
    const content = await readFile(componentPath, 'utf-8');
    return c.body(content, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return c.text('Renderer component not found', 404);
  }
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

// Serve plugin page component
renderers.get('/pages/:pluginId/:component.js', async (c) => {
  const pluginId = c.req.param('pluginId') ?? '';
  const component = c.req.param('component') ?? '';

  if (!/^[a-zA-Z0-9-]+$/.test(pluginId) || !/^[a-zA-Z0-9-]+$/.test(component)) {
    return c.text('Invalid parameters', 400);
  }

  const page = getPluginPage(pluginId, `/${component}`);
  if (!page) {
    return c.text('Page not found', 404);
  }

  const componentPath = join(page.dir, 'renderers', `${component}.tsx`);
  
  try {
    const content = await readFile(componentPath, 'utf-8');
    return c.body(content, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return c.text('Component not found', 404);
  }
});

// Memory API endpoint
const memory = new Hono();

memory.get('/:taskId/:type', async (c) => {
  const taskId = c.req.param('taskId');
  const type = c.req.param('type');

  if (type !== 'memory' && type !== 'summary') {
    return c.text('Invalid type', 400);
  }

  if (!/^[a-zA-Z0-9-_]+$/.test(taskId)) {
    return c.text('Invalid task ID', 400);
  }

  const tasksDir = join(agemonDir(), 'tasks');
  const filename = type === 'memory' ? 'MEMORY.md' : 'TASK_SUMMARY.md';
  const filePath = join(tasksDir, taskId, filename);

  try {
    const content = await readFile(filePath, 'utf-8');
    return c.text(content);
  } catch {
    return c.text('File not found', 404);
  }
});

export const renderersRoutes = renderers;
export const memoryRoutes = memory;

import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { PluginContext, PluginExports } from '../../backend/src/lib/plugins/types.ts';
import { renderTaskList, renderTaskFiles, renderFile } from './views.ts';

/** Reject path segments that could traverse directories. */
function isSafeSegment(s: string): boolean {
  return s.length > 0 && !s.includes('/') && !s.includes('\\') && s !== '..' && s !== '.';
}

export interface MemoryFile {
  taskId: string;
  type: 'memory' | 'summary';
  subpath: string;  // relative to task dir, e.g. "memory/MEMORY.md"
  path: string;     // absolute path
}

// Claude Code stores memory at {taskDir}/memory/MEMORY.md (cwd/memory/MEMORY.md).
// TASK_SUMMARY.md sits directly in the task dir (written by Agemon, not Claude).
const KNOWN_FILES: { subpath: string; type: MemoryFile['type'] }[] = [
  { subpath: 'memory/MEMORY.md', type: 'memory' },
  { subpath: 'TASK_SUMMARY.md', type: 'summary' },
];

async function discoverFiles(tasksDir: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];

  let taskDirs: string[];
  try {
    taskDirs = await readdir(tasksDir);
  } catch {
    return files;
  }

  for (const taskId of taskDirs) {
    const taskDir = join(tasksDir, taskId);
    // Skip non-directories
    try {
      const s = await stat(taskDir);
      if (!s.isDirectory()) continue;
    } catch { continue; }

    for (const { subpath, type } of KNOWN_FILES) {
      const filePath = join(taskDir, subpath);
      if (await Bun.file(filePath).exists()) {
        files.push({ taskId, type, subpath, path: filePath });
      }
    }
  }

  return files;
}

async function discoverTaskFiles(tasksDir: string, taskId: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const taskDir = join(tasksDir, taskId);

  for (const { subpath, type } of KNOWN_FILES) {
    const filePath = join(taskDir, subpath);
    if (await Bun.file(filePath).exists()) {
      files.push({ taskId, type, subpath, path: filePath });
    }
  }

  return files;
}

export function onLoad(ctx: PluginContext): PluginExports {
  const tasksDir = join(ctx.agemonDir, 'tasks');

  // API routes
  const api = new Hono();
  api.get('/files', async (c) => {
    const files = await discoverFiles(tasksDir);
    return c.json(files);
  });

  const pages = new Hono();
  pages.use(trimTrailingSlash());

  // GET / — list all tasks with memory/summary files, grouped by type
  pages.get('/', async (c) => {
    const files = await discoverFiles(tasksDir);
    return c.html(renderTaskList(files));
  });

  // GET /tasks/:taskId — list files for a specific task
  pages.get('/tasks/:taskId', async (c) => {
    const taskId = c.req.param('taskId');
    if (!isSafeSegment(taskId)) return c.text('Invalid task ID', 400);
    const files = await discoverTaskFiles(tasksDir, taskId);

    if (files.length === 0) {
      return c.text('No memory or summary files found for this task', 404);
    }

    return c.html(renderTaskFiles(taskId, files));
  });

  // GET /tasks/:taskId/:type — render memory or summary for a task (type = 'memory' | 'summary')
  pages.get('/tasks/:taskId/:type', async (c) => {
    const taskId = c.req.param('taskId');
    const type = c.req.param('type') as MemoryFile['type'];
    if (!isSafeSegment(taskId)) return c.text('Invalid task ID', 400);

    const known = KNOWN_FILES.find(f => f.type === type);
    if (!known) return c.text('Unknown type', 404);

    const filePath = resolve(tasksDir, taskId, known.subpath);
    if (!filePath.startsWith(tasksDir)) return c.text('Invalid path', 400);
    const file = Bun.file(filePath);
    if (!await file.exists()) {
      return c.text('File not found', 404);
    }

    const content = await file.text();
    return c.html(renderFile(taskId, known.subpath, content));
  });

  return {
    apiRoutes: api,
    pageRoutes: pages,
    pages: [
      { path: '/', component: 'memory-view' },
    ],
  };
}

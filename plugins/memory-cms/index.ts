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
  filename: string;
  path: string;
}

const KNOWN_FILES: { filename: string; type: MemoryFile['type'] }[] = [
  { filename: 'MEMORY.md', type: 'memory' },
  { filename: 'TASK_SUMMARY.md', type: 'summary' },
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

    for (const { filename, type } of KNOWN_FILES) {
      const filePath = join(taskDir, filename);
      if (await Bun.file(filePath).exists()) {
        files.push({ taskId, type, filename, path: filePath });
      }
    }
  }

  return files;
}

async function discoverTaskFiles(tasksDir: string, taskId: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const taskDir = join(tasksDir, taskId);

  for (const { filename, type } of KNOWN_FILES) {
    const filePath = join(taskDir, filename);
    if (await Bun.file(filePath).exists()) {
      files.push({ taskId, type, filename, path: filePath });
    }
  }

  return files;
}

export function onLoad(ctx: PluginContext): PluginExports {
  const tasksDir = join(ctx.agemonDir, 'tasks');
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

  // GET /tasks/:taskId/:filename — render a specific file
  pages.get('/tasks/:taskId/:filename', async (c) => {
    const taskId = c.req.param('taskId');
    const filename = c.req.param('filename');
    if (!isSafeSegment(taskId)) return c.text('Invalid task ID', 400);

    // Validate filename against known files (also prevents traversal)
    if (!KNOWN_FILES.some(f => f.filename === filename)) {
      return c.text('Unknown file', 404);
    }

    const filePath = resolve(tasksDir, taskId, filename);
    if (!filePath.startsWith(tasksDir)) return c.text('Invalid path', 400);
    const file = Bun.file(filePath);
    if (!await file.exists()) {
      return c.text('File not found', 404);
    }

    const content = await file.text();
    return c.html(renderFile(taskId, filename, content));
  });

  return { pageRoutes: pages };
}

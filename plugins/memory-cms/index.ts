import { Hono } from 'hono';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { PluginContext, PluginExports } from '../../backend/src/lib/plugins/types.ts';

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

  api.get('/memory/:taskId/:type', async (c) => {
    const taskId = c.req.param('taskId');
    const type = c.req.param('type');

    if (type !== 'memory' && type !== 'summary') {
      return c.text('Invalid type', 400);
    }

    if (!isSafeSegment(taskId)) {
      return c.text(`Invalid task ID: ${taskId}`, 400);
    }

    const subpath = type === 'memory' ? 'memory/MEMORY.md' : 'TASK_SUMMARY.md';
    const filePath = resolve(tasksDir, taskId, subpath);
    // Security check: ensure the resolved path is still within the tasks directory
    if (!filePath.startsWith(tasksDir)) return c.text('Invalid path', 400);

    const file = Bun.file(filePath);
    if (!await file.exists()) return c.text('File not found', 404);

    return c.text(await file.text());
  });

  return {
    apiRoutes: api,
    pages: [
      { path: '/', component: 'memory-view' },
    ],
  };
}

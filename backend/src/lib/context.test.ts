import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir, rm, writeFile, readFile, symlink, lstat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { Task } from '@agemon/shared';

// Stub agent plugin/skill paths so refreshTaskContext doesn't create real symlinks
mock.module('./agents.ts', () => ({
  getAllPluginPaths: () => [],
  getAllSkillPaths: () => [],
}));

// context.ts reads process.env.AGEMON_DIR dynamically via agemonDir(),
// so we just set the env var in beforeEach.
const { refreshTaskContext, getTaskDir, buildFirstPromptContext } = await import('./context.ts');

describe('context', () => {
  let testTaskDir: string;
  let originalAgemonDir: string | undefined;

  beforeEach(async () => {
    originalAgemonDir = process.env.AGEMON_DIR;
    testTaskDir = join(tmpdir(), `agemon-test-${randomUUID()}`);
    await mkdir(testTaskDir, { recursive: true });
    process.env.AGEMON_DIR = testTaskDir;
  });

  afterEach(async () => {
    if (originalAgemonDir === undefined) {
      delete process.env.AGEMON_DIR;
    } else {
      process.env.AGEMON_DIR = originalAgemonDir;
    }
    await rm(testTaskDir, { recursive: true, force: true });
  });

  test('getTaskDir returns correct path', () => {
    const taskId = 'test-task';
    const expected = join(testTaskDir, 'tasks', taskId);
    expect(getTaskDir(taskId)).toBe(expected);
  });

  test('refreshTaskContext creates task directory', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test Task',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };

    // Mock AGEMON_DIR temporarily

    await refreshTaskContext(task);

    const taskDir = join(testTaskDir, 'tasks', task.id);
    const claudeMdPath = join(taskDir, 'CLAUDE.md');

    const claudeMdExists = await lstat(claudeMdPath).then(() => true).catch(() => false);
    expect(claudeMdExists).toBe(true);

  });

  test('buildFirstPromptContext includes task title', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Fix authentication bug',
      description: 'Users cannot log in after password reset',
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    // Create task directory and CLAUDE.md
    await refreshTaskContext(task);

    const context = await buildFirstPromptContext(task);

    expect(context).toContain('Fix authentication bug');
    expect(context).toContain('Users cannot log in after password reset');

  });

  test('sanitizes task description to prevent injection', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test',
      description: '# Heading\n@file-ref',
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    await refreshTaskContext(task);

    const claudeMdPath = join(testTaskDir, 'tasks', task.id, 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');

    // Headings should be escaped
    expect(content).toContain('\\#');
    // @ symbols should be escaped
    expect(content).toContain('\\@');

  });

  test('handles tasks with no description', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Simple task',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    await refreshTaskContext(task);

    const claudeMdPath = join(testTaskDir, 'tasks', task.id, 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');

    expect(content).toContain('Simple task');
    expect(content).not.toContain('null');

  });

  test('refreshTaskContext is idempotent', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test Task',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    // Call twice
    await refreshTaskContext(task);
    await refreshTaskContext(task);

    const taskDir = join(testTaskDir, 'tasks', task.id);
    const claudeMdPath = join(taskDir, 'CLAUDE.md');

    const content1 = await readFile(claudeMdPath, 'utf-8');
    await refreshTaskContext(task);
    const content2 = await readFile(claudeMdPath, 'utf-8');

    expect(content1).toBe(content2);

  });

  test('includes environment context', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    await refreshTaskContext(task);

    const claudeMdPath = join(testTaskDir, 'tasks', task.id, 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');

    expect(content).toContain('Environment');
    expect(content).toContain('Agemon');
    expect(content).toContain('Git worktrees');

  });

  test('formats workspace layout for tasks with repos', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [
        { id: 1, url: 'git@github.com:acme/web.git', name: 'acme/web', created_at: new Date().toISOString() },
      ],
      archived: false,
      created_at: new Date().toISOString(),
    };


    await refreshTaskContext(task);

    const claudeMdPath = join(testTaskDir, 'tasks', task.id, 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');

    expect(content).toContain('Workspace Layout');
    expect(content).toContain('acme--web');
    expect(content).toContain('agemon/test-task-acme--web');

  });

  test('includes global CLAUDE.md if present', async () => {
    const task: Task = {
      id: 'test-task',
      title: 'Test',
      description: null,
      status: 'todo',
      agent: 'claude-code',
      repos: [],
      archived: false,
      created_at: new Date().toISOString(),
    };


    // Create global CLAUDE.md
    const globalClaudeMd = join(testTaskDir, 'CLAUDE.md');
    await writeFile(globalClaudeMd, '# Global Instructions\n\nAlways use TypeScript.');

    await refreshTaskContext(task);

    const claudeMdPath = join(testTaskDir, 'tasks', task.id, 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');

    // generateClaudeMd uses @filepath syntax to reference global CLAUDE.md
    expect(content).toContain('Global Instructions');
    expect(content).toContain(`@${globalClaudeMd}`);

  });
});

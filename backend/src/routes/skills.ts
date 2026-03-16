import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { readdir, readFile, mkdir, cp, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { InstalledSkill, SkillInstallResult, SkillPreview } from '@agemon/shared';

function sendError(statusCode: number, message: string): never {
  throw new HTTPException(statusCode as ContentfulStatusCode, { message });
}

function agemonDir(): string {
  return process.env.AGEMON_DIR ? resolve(process.env.AGEMON_DIR) : join(homedir(), '.agemon');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function runSkillsCli(
  args: string[],
  cwd?: string,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['npx', 'skills', ...args], {
    cwd: cwd ?? homedir(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DISABLE_TELEMETRY: '1' },
  });

  const timeoutId = setTimeout(() => proc.kill(), timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  return { stdout, stderr, exitCode };
}

async function parseSkillDir(dirPath: string): Promise<{ name: string; description: string } | null> {
  try {
    const content = await readFile(join(dirPath, 'SKILL.md'), 'utf-8');
    // Parse YAML frontmatter between --- delimiters
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) return null;
    return {
      name: nameMatch[1].trim(),
      description: descMatch?.[1].trim() ?? '',
    };
  } catch {
    return null;
  }
}

async function listDirSkills(baseDir: string, scope: InstalledSkill['scope']): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = [];
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const skillDir = join(baseDir, entry);
    const parsed = await parseSkillDir(skillDir);
    if (parsed) {
      skills.push({ ...parsed, path: skillDir, scope });
    }
  }
  return skills;
}

/** Strip ANSI escape codes from a string. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Parse `npx skills add <source> --list` output to extract skill names and descriptions.
 *
 * The CLI output format (after "Available Skills" header) is:
 *   │    skill-name
 *   │
 *   │      Description text here
 *   │
 *   │    next-skill-name
 *   ...
 *
 * Strategy: find the "Available Skills" marker, then scan for lines that look
 * like skill names (indented ~4 spaces after │, lowercase-with-hyphens) followed
 * by description lines (indented ~6 spaces after │).
 */
function parseListOutput(stdout: string): SkillPreview[] {
  const skills: SkillPreview[] = [];
  const clean = stripAnsi(stdout);
  const lines = clean.split('\n');

  // Find the "Available Skills" section
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Available Skills')) {
      startIdx = i + 1;
      break;
    }
  }

  // Parse skill entries: name lines have ~4 spaces indent, description lines have ~6
  let currentName: string | null = null;
  let currentDesc = '';

  for (let i = startIdx; i < lines.length; i++) {
    // Strip the │ prefix and any cursor control chars
    const raw = lines[i].replace(/^[│|]\s*/, '').replace(/[┌┘└┐─◇◆◈]+.*$/, '').trim();

    if (!raw) {
      // Empty line — if we have a current skill, it separates entries
      continue;
    }

    // Stop at footer lines
    if (raw.startsWith('Use --skill') || raw.startsWith('Run without')) break;

    // A skill name line: short, typically kebab-case, no spaces (or few words)
    // A description line: longer, typically a full sentence
    // Heuristic: if this line is short-ish and the previous content was empty or we just
    // flushed a skill, treat it as a new skill name. Otherwise it's a description.
    const looksLikeName = /^[a-z0-9][\w-]*$/.test(raw);

    if (looksLikeName) {
      // Flush previous skill
      if (currentName) {
        skills.push({ name: currentName, description: currentDesc.trim() });
      }
      currentName = raw;
      currentDesc = '';
    } else if (currentName) {
      // Append to description (may span multiple lines)
      currentDesc += (currentDesc ? ' ' : '') + raw;
    }
  }

  // Flush last skill
  if (currentName) {
    skills.push({ name: currentName, description: currentDesc.trim() });
  }

  return skills;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const skillsRoutes = new Hono();

// ── Global Skills ───────────────────────────────────────────────────────────

skillsRoutes.get('/skills', async (c) => {
  const globalSkillsDir = join(agemonDir(), 'skills');
  const skills = await listDirSkills(globalSkillsDir, 'global');
  return c.json({ skills });
});

skillsRoutes.post('/skills/preview', async (c) => {
  const body = await c.req.json();
  const source = body?.source;

  if (typeof source !== 'string' || !source.trim()) {
    sendError(400, 'source is required');
  }

  const result = await runSkillsCli(['add', source, '--list'], undefined, 60_000);

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return c.json({
      ok: false,
      skills: [],
      error: stripAnsi(result.stderr.trim() || 'Failed to fetch skills'),
    });
  }

  const skills = parseListOutput(result.stdout);
  return c.json({ ok: skills.length > 0, skills, error: skills.length === 0 ? 'No skills found in this source' : undefined });
});

skillsRoutes.post('/skills', async (c) => {
  const body = await c.req.json();
  const source = body?.source;
  const skillNames: string[] | undefined = body?.skillNames;

  if (typeof source !== 'string' || !source.trim()) {
    sendError(400, 'source is required');
  }

  const args = ['add', source, '--global', '--yes', '--agent', 'claude-code'];
  if (skillNames?.length) {
    for (const name of skillNames) {
      args.push('--skill', name);
    }
  }

  const result = await runSkillsCli(args);

  if (result.exitCode !== 0) {
    return c.json({
      ok: false,
      error: result.stderr.trim() || result.stdout.trim() || 'Installation failed',
    } satisfies SkillInstallResult);
  }

  // The skills CLI installs to ~/.claude/skills/.
  // Copy newly installed skills into ~/.agemon/skills/ so Agemon's wiring picks them up.
  const claudeSkillsDir = join(homedir(), '.claude', 'skills');
  const agemonSkillsDir = join(agemonDir(), 'skills');
  await mkdir(agemonSkillsDir, { recursive: true });

  const installed: string[] = [];
  try {
    const entries = await readdir(claudeSkillsDir);
    for (const entry of entries) {
      // Skip the 'agemon' symlink that points back to ~/.agemon/skills
      if (entry === 'agemon') continue;
      const src = join(claudeSkillsDir, entry);
      const parsed = await parseSkillDir(src);
      if (parsed) {
        const dest = join(agemonSkillsDir, entry);
        await cp(src, dest, { recursive: true, force: true });
        installed.push(parsed.name);
      }
    }
  } catch {
    // If ~/.claude/skills doesn't exist or is empty, that's fine
  }

  return c.json({ ok: true, installed } satisfies SkillInstallResult, 201);
});

skillsRoutes.delete('/skills/:name', async (c) => {
  const name = c.req.param('name');

  // Remove from global ~/.claude/skills via CLI
  await runSkillsCli(['remove', name, '--global', '--yes']);

  // Also remove from ~/.agemon/skills/<name>/
  const agemonSkillPath = join(agemonDir(), 'skills', name);
  await rm(agemonSkillPath, { recursive: true, force: true }).catch(() => {});

  return c.json({ ok: true });
});

// ── Task-level Skills ───────────────────────────────────────────────────────

skillsRoutes.get('/tasks/:taskId/skills', async (c) => {
  const taskId = c.req.param('taskId');
  const taskDir = join(agemonDir(), 'tasks', taskId);

  // Global skills from ~/.agemon/skills/
  const globalSkills = await listDirSkills(join(agemonDir(), 'skills'), 'global');

  // Task-level skills from {taskDir}/.claude/skills/ (excluding symlinks to global/agemon)
  const taskSkills: InstalledSkill[] = [];
  const taskSkillsDir = join(taskDir, '.claude', 'skills');
  try {
    const entries = await readdir(taskSkillsDir);
    for (const entry of entries) {
      // Skip Agemon-managed symlinks (prefixed with _ or named 'agemon')
      if (entry.startsWith('_') || entry === 'agemon') continue;
      const skillDir = join(taskSkillsDir, entry);
      const parsed = await parseSkillDir(skillDir);
      if (parsed) {
        taskSkills.push({ ...parsed, path: skillDir, scope: 'task' });
      }
    }
  } catch {
    // Task dir may not exist yet
  }

  // Repo-level skills from {taskDir}/.agemonskills/
  const repoSkillsDir = join(taskDir, '.agemonskills');
  try {
    const repoEntries = await readdir(repoSkillsDir);
    for (const repoEntry of repoEntries) {
      const repoDir = join(repoSkillsDir, repoEntry);
      const subSkills = await listDirSkills(repoDir, 'repo');
      taskSkills.push(...subSkills);
    }
  } catch {
    // No repo skills
  }

  return c.json({ global: globalSkills, task: taskSkills });
});

skillsRoutes.post('/tasks/:taskId/skills', async (c) => {
  const taskId = c.req.param('taskId');
  const taskDir = join(agemonDir(), 'tasks', taskId);
  const body = await c.req.json();
  const source = body?.source;
  const skillNames: string[] | undefined = body?.skillNames;

  if (typeof source !== 'string' || !source.trim()) {
    sendError(400, 'source is required');
  }

  await mkdir(taskDir, { recursive: true });

  const args = ['add', source, '--yes', '--agent', 'claude-code'];
  if (skillNames?.length) {
    for (const name of skillNames) {
      args.push('--skill', name);
    }
  }

  const result = await runSkillsCli(args, taskDir);

  if (result.exitCode !== 0) {
    return c.json({
      ok: false,
      error: result.stderr.trim() || result.stdout.trim() || 'Installation failed',
    } satisfies SkillInstallResult);
  }

  // Discover what was installed
  const installed: string[] = [];
  const taskSkillsDir = join(taskDir, '.claude', 'skills');
  try {
    const entries = await readdir(taskSkillsDir);
    for (const entry of entries) {
      if (entry.startsWith('_') || entry === 'agemon') continue;
      const parsed = await parseSkillDir(join(taskSkillsDir, entry));
      if (parsed) installed.push(parsed.name);
    }
  } catch {
    // fine
  }

  return c.json({ ok: true, installed } satisfies SkillInstallResult, 201);
});

skillsRoutes.delete('/tasks/:taskId/skills/:name', async (c) => {
  const taskId = c.req.param('taskId');
  const name = c.req.param('name');
  const taskDir = join(agemonDir(), 'tasks', taskId);

  // Remove the skill directory from {taskDir}/.claude/skills/<name>/
  const skillPath = join(taskDir, '.claude', 'skills', name);
  await rm(skillPath, { recursive: true, force: true }).catch(() => {});

  return c.json({ ok: true });
});

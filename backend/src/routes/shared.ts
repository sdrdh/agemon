import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { db } from '../db/client.ts';
import type { AgentType, Task, TaskStatus } from '@agemon/shared';
import { AGENT_TYPES, SSH_REPO_REGEX } from '@agemon/shared';

export function sendError(statusCode: number, message: string): never {
  throw new HTTPException(statusCode as ContentfulStatusCode, { message });
}

export function validateTaskFields(fields: { title?: string; description?: string | null; agent?: AgentType }): void {
  if (fields.agent !== undefined && !(AGENT_TYPES as readonly string[]).includes(fields.agent))
    sendError(400, `agent must be one of: ${[...AGENT_TYPES].join(', ')}`);
  if (fields.title !== undefined && fields.title.length > 500)
    sendError(400, 'title must be 500 characters or fewer');
  if (fields.description !== undefined && fields.description !== null && fields.description.length > 10000)
    sendError(400, 'description must be 10000 characters or fewer');
}

const HTTPS_TO_SSH_RE = /^https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

function httpsToSsh(url: string): string {
  const m = HTTPS_TO_SSH_RE.exec(url);
  return m ? `git@${m[1]}:${m[2]}/${m[3]}.git` : url;
}

export function validateRepoUrls(repos: unknown): string[] {
  if (!Array.isArray(repos)) sendError(400, 'repos must be an array');
  if (repos.length > 20) sendError(400, 'repos must contain 20 or fewer entries');
  if (!repos.every(r => typeof r === 'string' && r.length <= 500))
    sendError(400, 'each repo URL must be 500 characters or fewer');
  const normalized = repos.map(httpsToSsh);
  if (!normalized.every(r => SSH_REPO_REGEX.test(r)))
    sendError(400, 'each repo must be a valid SSH or HTTPS URL (git@host:org/repo.git or https://github.com/org/repo)');
  return normalized;
}

export function requireTask(id: string): Task {
  const task = db.getTask(id);
  if (!task) sendError(404, 'Task not found');
  return task!;
}

export const VALID_TASK_STATUSES = new Set<TaskStatus>(['todo', 'working', 'awaiting_input', 'done']);

/**
 * Persistent "Always Allow" approval rules.
 * Stored as ~/.agemon/approval-rules.json — a small global config file.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { AGEMON_DIR } from './git.ts';
import type { ApprovalRule } from '@agemon/shared';

// ─── Module State ─────────────────────────────────────────────────────────────

let _rules: ApprovalRule[] = [];

function getRulesPath(): string {
  return join(AGEMON_DIR, 'approval-rules.json');
}

// ─── Startup Loading ──────────────────────────────────────────────────────────

export function loadApprovalRules(): void {
  const path = getRulesPath();
  if (!existsSync(path)) return;
  try {
    _rules = JSON.parse(readFileSync(path, 'utf8'));
    if (_rules.length > 0) {
      console.info(`[approval-rules] loaded ${_rules.length} rule(s)`);
    }
  } catch (err) {
    console.warn(`[approval-rules] failed to load:`, (err as Error).message);
    _rules = [];
  }
}

function flush(): void {
  atomicWriteJsonSync(getRulesPath(), _rules);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function insertApprovalRule(rule: ApprovalRule): void {
  _rules.push(rule);
  flush();
}

/**
 * Find a matching approval rule for a tool.
 * Matches: exact taskId > global (null taskId). sessionId is ignored (rules apply across sessions).
 */
export function findApprovalRule(
  toolName: string,
  taskId: string | null,
  _sessionId: string | null
): ApprovalRule | null {
  let globalMatch: ApprovalRule | null = null;
  let taskMatch: ApprovalRule | null = null;

  for (const rule of _rules) {
    if (rule.toolName !== toolName) continue;
    if (rule.taskId === null) {
      globalMatch = rule;
    } else if (taskId && rule.taskId === taskId) {
      taskMatch = rule;
    }
  }

  // Task-specific rules take precedence over global
  return taskMatch ?? globalMatch ?? null;
}

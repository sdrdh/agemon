/**
 * In-memory approval store, backed by per-session approvals.json files.
 *
 * Write path:
 *   1. Update in-memory Map
 *   2. Flush approvals.json to the session's directory (if known)
 *
 * Session dirs are registered by event-log.ts after initSessionLog() creates the dir.
 * Until then, approvals are buffered in memory and flushed when
 * flushPendingApprovals() is called.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { sessionDirs } from './acp/session-dirs.ts';
import type { PendingApproval, ApprovalDecision } from '@agemon/shared';

// ─── Module State ─────────────────────────────────────────────────────────────

/** In-memory index: sessionId → approvals for that session. */
const approvalsBySession = new Map<string, PendingApproval[]>();

/** Fast lookup by approval id → the approval object. */
const approvalsById = new Map<string, PendingApproval>();

// ─── Persistence Helpers ──────────────────────────────────────────────────────

const APPROVALS_FILE = 'approvals.json';

/** Write approvals.json for a session. No-op if the session dir isn't known yet. */
function flushToDisk(sessionId: string): void {
  const dir = sessionDirs.get(sessionId);
  if (!dir) return;
  const approvals = approvalsBySession.get(sessionId) ?? [];
  atomicWriteJsonSync(join(dir, APPROVALS_FILE), approvals);
}

// ─── Startup Loading ──────────────────────────────────────────────────────────

/**
 * Scan all session directories and load approvals.json files into memory.
 * Must be called once at startup after buildSessionDb() has populated sessionDirs.
 */
export function loadApprovalsFromDisk(): void {
  let loaded = 0;
  for (const [sessionId, dir] of sessionDirs) {
    const filePath = join(dir, APPROVALS_FILE);
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      const approvals: PendingApproval[] = JSON.parse(raw);
      approvalsBySession.set(sessionId, approvals);
      for (const a of approvals) {
        approvalsById.set(a.id, a);
      }
      loaded += approvals.length;
    } catch (err) {
      console.warn(`[approval-store] failed to load ${filePath}:`, (err as Error).message);
    }
  }

  if (loaded > 0) {
    console.info(`[approval-store] loaded ${loaded} approval(s) from filesystem`);
  }
}

// ─── Flush Hook (called by event-log.ts after dir init) ──────────────────────

/**
 * Flush buffered approvals for a session to disk.
 * Called by event-log.ts after the session directory has been created.
 */
export function flushPendingApprovals(sessionId: string): void {
  if (approvalsBySession.has(sessionId)) {
    flushToDisk(sessionId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function insertPendingApproval(approval: PendingApproval): void {
  const list = approvalsBySession.get(approval.sessionId) ?? [];
  list.push(approval);
  approvalsBySession.set(approval.sessionId, list);
  approvalsById.set(approval.id, approval);
  flushToDisk(approval.sessionId);
}

export function resolvePendingApproval(id: string, decision: ApprovalDecision): void {
  const approval = approvalsById.get(id);
  if (!approval) return;
  approval.status = 'resolved';
  approval.decision = decision;
  flushToDisk(approval.sessionId);
}

export function getPendingApproval(id: string): PendingApproval | null {
  return approvalsById.get(id) ?? null;
}

/** All approvals (any status) for a session. Used by chat history builder. */
export function listApprovalsBySession(sessionId: string): PendingApproval[] {
  return approvalsBySession.get(sessionId) ?? [];
}

/** All pending approvals for a given taskId. */
export function listPendingApprovals(taskId: string): PendingApproval[] {
  const results: PendingApproval[] = [];
  for (const list of approvalsBySession.values()) {
    for (const a of list) {
      if (a.taskId === taskId && a.status === 'pending') {
        results.push(a);
      }
    }
  }
  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return results;
}

/** All pending approvals for a given session. */
export function listPendingApprovalsBySession(sessionId: string): PendingApproval[] {
  const list = approvalsBySession.get(sessionId) ?? [];
  return list
    .filter(a => a.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** All pending approvals across every session, sorted by createdAt DESC. */
export function listAllPendingApprovals(): PendingApproval[] {
  const results: PendingApproval[] = [];
  for (const list of approvalsBySession.values()) {
    for (const a of list) {
      if (a.status === 'pending') {
        results.push(a);
      }
    }
  }
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}

/** All approvals (any status) for a given taskId, sorted by createdAt ASC. */
export function listAllApprovals(taskId: string): PendingApproval[] {
  const results: PendingApproval[] = [];
  for (const list of approvalsBySession.values()) {
    for (const a of list) {
      if (a.taskId === taskId) {
        results.push(a);
      }
    }
  }
  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return results;
}

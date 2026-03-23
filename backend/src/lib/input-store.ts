/**
 * In-memory input store, backed by per-session inputs.json files.
 *
 * Replaces the SQLite `awaiting_input` table with an in-memory Map
 * and per-session JSON file persistence.
 *
 * Write path:
 *   1. Update in-memory Maps
 *   2. Flush inputs.json to the session's directory (if known)
 *
 * Session dirs are registered by event-log.ts after initSessionLog() creates the dir.
 * Until then, inputs are buffered in memory and flushed when
 * flushPendingInputs() is called.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { sessionDirs } from './acp/session-dirs.ts';
import type { AwaitingInput } from '@agemon/shared';

// ─── Module State ─────────────────────────────────────────────────────────────

/** In-memory index: sessionId → inputs for that session. */
const inputsBySession = new Map<string, AwaitingInput[]>();

/** Fast lookup by input id → the input object. */
const inputsById = new Map<string, AwaitingInput>();

// ─── Persistence Helpers ──────────────────────────────────────────────────────

const INPUTS_FILE = 'inputs.json';

/** Write inputs.json for a session. No-op if the session dir isn't known yet. */
function flushToDisk(sessionId: string): void {
  const dir = sessionDirs.get(sessionId);
  if (!dir) return;
  const inputs = inputsBySession.get(sessionId) ?? [];
  atomicWriteJsonSync(join(dir, INPUTS_FILE), inputs);
}

// ─── Startup Loading ──────────────────────────────────────────────────────────

/**
 * Scan all session directories and load inputs.json files into memory.
 * Must be called once at startup after buildSessionDb() has populated sessionDirs.
 */
export function loadInputsFromDisk(): void {
  let loaded = 0;
  for (const [sessionId, dir] of sessionDirs) {
    const filePath = join(dir, INPUTS_FILE);
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      const inputs: AwaitingInput[] = JSON.parse(raw);
      inputsBySession.set(sessionId, inputs);
      for (const input of inputs) {
        inputsById.set(input.id, input);
      }
      loaded += inputs.length;
    } catch (err) {
      console.warn(`[input-store] failed to load ${filePath}:`, (err as Error).message);
    }
  }

  if (loaded > 0) {
    console.info(`[input-store] loaded ${loaded} input(s) from filesystem`);
  }
}

// ─── Flush Hook (called by event-log.ts after dir init) ──────────────────────

/**
 * Flush buffered inputs for a session to disk.
 * Called by event-log.ts after the session directory has been created.
 */
export function flushPendingInputs(sessionId: string): void {
  if (inputsBySession.has(sessionId)) {
    flushToDisk(sessionId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function insertAwaitingInput(input: {
  id: string;
  task_id?: string | null;
  session_id: string;
  question: string;
}): AwaitingInput {
  const now = new Date().toISOString();
  const record: AwaitingInput = {
    id: input.id,
    task_id: input.task_id ?? null,
    session_id: input.session_id,
    question: input.question,
    status: 'pending',
    response: null,
    created_at: now,
  };

  const list = inputsBySession.get(record.session_id) ?? [];
  list.push(record);
  inputsBySession.set(record.session_id, list);
  inputsById.set(record.id, record);
  flushToDisk(record.session_id);

  return record;
}

export function answerInput(id: string, response: string): AwaitingInput | null {
  const input = inputsById.get(id);
  if (!input) return null;
  input.status = 'answered';
  input.response = response;
  flushToDisk(input.session_id);
  return input;
}

/** All inputs (any status) for a session. Used by chat history builder. */
export function listInputsBySession(sessionId: string): AwaitingInput[] {
  return inputsBySession.get(sessionId) ?? [];
}

/** All pending inputs for a given taskId, sorted by created_at ASC. */
export function listPendingInputs(taskId: string): AwaitingInput[] {
  const results: AwaitingInput[] = [];
  for (const list of inputsBySession.values()) {
    for (const input of list) {
      if (input.task_id === taskId && input.status === 'pending') {
        results.push(input);
      }
    }
  }
  results.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return results;
}

/** All pending inputs across every session, sorted by created_at DESC. */
export function listAllPendingInputs(): AwaitingInput[] {
  const results: AwaitingInput[] = [];
  for (const list of inputsBySession.values()) {
    for (const input of list) {
      if (input.status === 'pending') {
        results.push(input);
      }
    }
  }
  results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return results;
}

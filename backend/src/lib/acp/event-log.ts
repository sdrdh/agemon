/**
 * Per-session JSONL event log.
 * Each session gets its own directory: ~/.agemon/sessions/{timestamp}_{sessionId}/
 *   events.jsonl  — append-only ACP event stream
 *   meta.json     — session metadata snapshot
 */
import { mkdir, appendFile, readFile, writeFile, readdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { AGEMON_DIR } from '../git.ts';
import { sessionDirs as _sessionDirs } from './session-dirs.ts';
import { writeSessionJson } from '../session-store.ts';

export interface JsonlEvent {
  id: string;
  type: string;
  content: string;
  ts: string;
}

export interface SessionLogMeta {
  sessionId: string;
  agentType: string;
  startedAt: string;
  meta: Record<string, unknown>;
  endedAt?: string;
  checkpoint?: {
    state: string;
    pendingInputId: string | null;
  };
}

// In-memory map: sessionId -> session log directory path (shared with session-store.ts)
export { sessionDirs } from './session-dirs.ts';

// Events that arrived before initSessionLog resolved, keyed by sessionId
const pendingEvents = new Map<string, JsonlEvent[]>();

/** Get or create the session log directory path. */
export function getSessionLogDir(sessionId: string): string {
  if (_sessionDirs.has(sessionId)) return _sessionDirs.get(sessionId)!;
  throw new Error(`Session log directory not initialized for session ${sessionId}`);
}

/**
 * Initialize the session log directory and write meta.json.
 * Called once when the session is first spawned.
 */
export async function initSessionLog(
  sessionId: string,
  agentType: string,
  meta: Record<string, unknown>,
  agemonDir: string,
): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = `${ts}_${sessionId}`;
  const sessionsDir = join(agemonDir, 'sessions');
  const logDir = join(sessionsDir, dirName);

  await mkdir(logDir, { recursive: true });
  _sessionDirs.set(sessionId, logDir);

  const logMeta: SessionLogMeta = {
    sessionId,
    agentType,
    startedAt: new Date().toISOString(),
    meta,
  };
  await writeFile(join(logDir, 'meta.json'), JSON.stringify(logMeta, null, 2));

  // Flush any events that arrived during the init window
  const queued = pendingEvents.get(sessionId);
  if (queued?.length) {
    pendingEvents.delete(sessionId);
    const lines = queued.map(e => JSON.stringify(e) + '\n').join('');
    await appendFile(join(logDir, 'events.jsonl'), lines, 'utf8');
  }

  // Flush pending session.json now that the dir exists
  writeSessionJson(sessionId, logDir);
}

/**
 * Append one event to the session's events.jsonl.
 * Fire-and-forget — never block notification handling.
 */
export async function appendEvent(sessionId: string, event: JsonlEvent): Promise<void> {
  const logDir = _sessionDirs.get(sessionId);
  if (!logDir) {
    // Dir not ready yet — queue until initSessionLog resolves.
    // (Also covers genuinely legacy sessions where the dir will never arrive —
    //  those entries are evicted naturally since the Map is never flushed for them,
    //  but the memory cost is negligible for the small number of early events.)
    const q = pendingEvents.get(sessionId) ?? [];
    q.push(event);
    pendingEvents.set(sessionId, q);
    return;
  }
  const line = JSON.stringify(event) + '\n';
  await appendFile(join(logDir, 'events.jsonl'), line, 'utf8');
}

/**
 * Read all events from a session's JSONL log (async version).
 * Returns empty array if the file doesn't exist.
 */
export async function readSessionEvents(sessionId: string, agemonDir: string): Promise<JsonlEvent[]> {
  const logDir = await findSessionLogDir(sessionId, agemonDir);
  if (!logDir) return [];

  const eventsPath = join(logDir, 'events.jsonl');
  let text: string;
  try {
    text = await readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }

  return parseJsonlText(text);
}

/**
 * Synchronous JSONL reader — used by listChatHistoryBySession
 * to avoid making it async (which would change all callers).
 *
 * TODO: For large sessions this blocks the event loop. Migrate callers to async
 * and switch to a streaming read or a cached in-memory projection.
 */
export function readSessionEventsSync(sessionId: string): JsonlEvent[] {
  const logDir = _sessionDirs.get(sessionId);
  if (!logDir) return [];
  const eventsPath = join(logDir, 'events.jsonl');
  try {
    const text = readFileSync(eventsPath, 'utf8');
    return parseJsonlText(text);
  } catch {
    return [];
  }
}

function parseJsonlText(text: string): JsonlEvent[] {
  const events: JsonlEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

/**
 * Find the session log directory by scanning ~/.agemon/sessions/ for a dir ending in _{sessionId}.
 * Returns null if not found (legacy session stored in SQLite).
 */
export async function findSessionLogDir(sessionId: string, agemonDir: string): Promise<string | null> {
  // Check in-memory cache first
  if (_sessionDirs.has(sessionId)) return _sessionDirs.get(sessionId)!;

  const sessionsDir = join(agemonDir, 'sessions');
  if (!existsSync(sessionsDir)) return null;

  try {
    const entries = await readdir(sessionsDir);
    const match = entries.find(e => e.endsWith(`_${sessionId}`));
    if (match) {
      const dir = join(sessionsDir, match);
      _sessionDirs.set(sessionId, dir);
      return dir;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Write a checkpoint to meta.json when session ends cleanly.
 * Allows O(1) startup recovery — no JSONL replay needed for finished sessions.
 */
export async function writeCheckpoint(
  sessionId: string,
  state: string,
  pendingInputId: string | null,
): Promise<void> {
  const logDir = _sessionDirs.get(sessionId);
  if (!logDir) return;

  const metaPath = join(logDir, 'meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta: SessionLogMeta = JSON.parse(raw);
    meta.endedAt = new Date().toISOString();
    meta.checkpoint = { state, pendingInputId };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // ignore — checkpoint is best-effort
  }
}

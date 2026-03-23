// Sessions are now backed by per-session session.json files + in-memory SQLite.
// All functions delegate to session-store.ts; callers are unchanged.
export {
  getSession,
  listSessions,
  listSessionsByState,
  insertSession,
  updateSessionState,
  updateSessionName,
  updateSessionLastMessage,
  updateSessionArchived,
  archiveSessionsByTask,
  updateSessionUsage,
  updateSessionConfigOptions,
  getSessionConfigOptions,
  updateSessionAvailableCommands,
  getSessionAvailableCommands,
  listActiveSessions,
  listAllSessions,
} from '../lib/session-store.ts';

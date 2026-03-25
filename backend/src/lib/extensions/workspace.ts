/**
 * WorkspaceProvider interface.
 *
 * Decouples agent spawning from the task-based workspace setup.
 * Plugins can register a WorkspaceProvider to control where an agent runs
 * and what context it receives. The default implementation wraps the existing
 * task directory + git worktree logic.
 */

export interface SessionMeta {
  sessionId: string;
  agentType: string;
  meta: Record<string, unknown>;  // parsed from session.meta_json if it exists, else {}
}

/** Per-repository diff result returned by WorkspaceProvider.getDiff. */
export interface RepoDiff {
  repoName: string;  // display name, e.g. "acme/web" or dir basename for cwd sessions
  cwd: string;       // absolute path to the git repo root
  diff: string;      // unified diff string (may be empty)
}

export interface WorkspaceResult {
  cwd: string;
  meta?: Record<string, unknown>;  // optional metadata to merge back into session meta
}

export interface WorkspaceProvider {
  /**
   * Prepare workspace before agent spawns.
   * Returns the cwd the agent should run in.
   * Long operations must respect the AbortSignal.
   */
  prepare(session: SessionMeta, signal: AbortSignal): Promise<WorkspaceResult>;

  /**
   * Clean up after session ends. Optional — no-op for local-dir.
   */
  cleanup?(session: SessionMeta): Promise<void>;

  /**
   * Generate a diff of changes. Optional — only for VCS-backed workspaces.
   * Only `getDiff` uses a plain meta bag; other methods keep SessionMeta because
   * they run in the context of a live session and legitimately need sessionId/agentType.
   */
  getDiff?(meta: Record<string, unknown>): Promise<RepoDiff[] | null>;

  /**
   * Extra markdown sections to inject into CLAUDE.md context.
   */
  contextSections?(session: SessionMeta): Promise<string[]>;

  /**
   * Extra constraint sections to inject into CLAUDE.md.
   */
  guidelinesSections?(session: SessionMeta): Promise<string[]>;
}

/**
 * Resolve the CWD for a session.
 * Priority:
 *   1. WorkspaceProvider.prepare() if a provider is given
 *   2. sessionMeta.meta.cwd if set
 *   3. Throws
 */
export async function resolveWorkspaceCwd(
  session: SessionMeta,
  provider: WorkspaceProvider | null,
  signal: AbortSignal,
): Promise<string> {
  if (provider) {
    const result = await provider.prepare(session, signal);
    return result.cwd;
  }
  const cwd = session.meta.cwd;
  if (typeof cwd === 'string' && cwd) return cwd;
  throw new Error(
    `No workspace provider and session.meta.cwd is not set. ` +
    `Either attach a WorkspaceProvider plugin or set meta.cwd when creating the session.`
  );
}

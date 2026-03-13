import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions } from './session-registry.ts';
import { spawnProcess } from './spawn.ts';
import { deriveTaskStatus } from './task-status.ts';
import { AGENT_CONFIGS } from '../agents.ts';
import { getTaskDir, refreshTaskContext } from '../context.ts';
import { mkdir } from 'fs/promises';
import type { AgentSession, Task } from '@agemon/shared';

/**
 * Ensure the task directory exists and context artifacts are current.
 */
async function prepareTaskDir(task: Task): Promise<void> {
  const taskDir = getTaskDir(task.id);
  await mkdir(taskDir, { recursive: true });
  await refreshTaskContext(task);
}

/** Dispatch to the agent-specific config option parser. */
function parseConfigOptions(agentType: string, result: Record<string, unknown>) {
  return AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS].parseConfigOptions(result);
}

/**
 * Resume a stopped/crashed/interrupted session by spawning a new process.
 * Attempts session/load if the agent supports it, falls back to session/new.
 */
export async function resumeSession(sessionId: string): Promise<AgentSession> {
  const sessionRecord = db.getSession(sessionId);
  if (!sessionRecord) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (sessionRecord.state !== 'stopped' && sessionRecord.state !== 'crashed' && sessionRecord.state !== 'interrupted') {
    throw new Error(`Session ${sessionId} is in state ${sessionRecord.state}, can only resume stopped, crashed, or interrupted sessions`);
  }

  const taskId = sessionRecord.task_id;
  const task = db.getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const agentType = sessionRecord.agent_type;
  const storedExternalId = sessionRecord.external_session_id;

  // Reset session state for re-use
  db.updateSessionState(sessionId, 'starting', { pid: null, exit_code: null });

  const rs = spawnProcess(sessionId, taskId, agentType);

  const agentCwd = getTaskDir(taskId);
  await prepareTaskDir(task);

  // Run handshake, then attempt session/load
  try {
    // 1. Initialize
    const initResult = await rs.transport.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'agemon', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    const capabilities = initResult &&
      typeof initResult === 'object' &&
      'capabilities' in (initResult as Record<string, unknown>)
        ? (initResult as Record<string, unknown>).capabilities as Record<string, unknown> | undefined
        : undefined;
    const supportsLoadSession = !!capabilities?.loadSession;

    let acpSessionId: string | null = null;
    let sessionResultObj: Record<string, unknown> | null = null;

    // 2. Try session/load if supported and we have a stored external ID
    const mcpServers = db.getMergedMcpServers(sessionRecord.task_id);
    if (supportsLoadSession && storedExternalId) {
      try {
        const loadResult = await rs.transport.request('session/load', {
          sessionId: storedExternalId,
          cwd: agentCwd,
          mcpServers,
        });

        sessionResultObj = loadResult as Record<string, unknown> | null;
        acpSessionId = loadResult &&
          typeof loadResult === 'object' &&
          'sessionId' in (loadResult as Record<string, unknown>)
            ? String((loadResult as Record<string, unknown>).sessionId)
            : storedExternalId;

        console.info(`[acp] session ${sessionId} resumed via session/load`);
      } catch (err) {
        console.warn(`[acp] session/load failed for ${sessionId}, falling back to session/new:`, err);
        acpSessionId = null;
      }
    }

    // 3. Fall back to session/new if load didn't work
    if (!acpSessionId) {
      const sessionResult = await rs.transport.request('session/new', {
        cwd: agentCwd,
        mcpServers,
      });

      sessionResultObj = sessionResult as Record<string, unknown> | null;
      acpSessionId = sessionResult &&
        typeof sessionResult === 'object' &&
        'sessionId' in (sessionResult as Record<string, unknown>)
          ? String((sessionResult as Record<string, unknown>).sessionId)
          : null;

      console.info(`[acp] session ${sessionId} resumed via session/new (fresh)`);
    }

    if (rs && acpSessionId) {
      rs.acpSessionId = acpSessionId;
    }

    // Extract config options from session response
    if (rs && sessionResultObj) {
      const configOptions = parseConfigOptions(rs.agentType,sessionResultObj);
      if (configOptions.length > 0) {
        rs.configOptions = configOptions;
        db.updateSessionConfigOptions(sessionId, configOptions);
        broadcast({ type: 'config_options_updated', sessionId, taskId, configOptions });
        console.info(`[acp] session ${sessionId} config options: ${configOptions.map(o => o.id).join(', ')}`);
      }
    }

    const extra: { external_session_id?: string } = {};
    if (acpSessionId) extra.external_session_id = acpSessionId;

    db.updateSessionState(sessionId, 'ready', extra);
    const session = db.getSession(sessionId)!;
    broadcast({ type: 'session_ready', taskId, session });

    // Re-derive task status now that session is ready (→ awaiting_input)
    deriveTaskStatus(taskId);

    return session;
  } catch (err) {
    console.error(`[acp] resume error for session ${sessionId}:`, err);
    // Don't change state here — handleExit will handle it when the process dies
    throw err;
  }
}

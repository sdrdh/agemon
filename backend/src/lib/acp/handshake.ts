import { db } from '../../db/client.ts';
import { broadcast } from '../../server.ts';
import { sessions } from './session-registry.ts';
import { deriveTaskStatus } from './task-status.ts';
import { AGENT_CONFIGS } from '../agents.ts';
import type { JsonRpcTransport } from '../jsonrpc.ts';
import type { AgentType } from '@agemon/shared';

/** Dispatch to the agent-specific config option parser. */
function parseConfigOptions(agentType: AgentType, result: Record<string, unknown>) {
  return AGENT_CONFIGS[agentType].parseConfigOptions(result);
}

/**
 * Run the ACP handshake only (initialize + session/new).
 * Transitions session to `ready` state — does NOT send a prompt.
 */
export async function runAcpHandshake(
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string | null,
  cwd: string
): Promise<void> {
  try {
    // 1. Initialize — exchange capabilities
    const initResult = await transport.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'agemon', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    // Store loadSession capability for resume support
    const capabilities = initResult &&
      typeof initResult === 'object' &&
      'capabilities' in (initResult as Record<string, unknown>)
        ? (initResult as Record<string, unknown>).capabilities as Record<string, unknown> | undefined
        : undefined;
    const supportsLoadSession = !!capabilities?.loadSession;

    // 2. Create ACP session via session/new
    const mcpServers = taskId ? db.getMergedMcpServers(taskId) : db.listGlobalMcpServers();
    if (mcpServers.length > 0) {
      console.info(`[acp] session ${sessionId} passing ${mcpServers.length} MCP server(s): ${mcpServers.map(s => s.name).join(', ')}`);
    }
    const sessionResult = await transport.request('session/new', {
      cwd,
      mcpServers,
    });

    // Extract the ACP session ID returned by the agent
    const acpSessionId =
      sessionResult &&
      typeof sessionResult === 'object' &&
      'sessionId' in (sessionResult as Record<string, unknown>)
        ? String((sessionResult as Record<string, unknown>).sessionId)
        : null;

    // Store ACP session ID on the running session
    const rs = sessions.get(sessionId);
    if (rs && acpSessionId) {
      rs.acpSessionId = acpSessionId;
    }

    // Extract config options from session/new response
    const resultObj = sessionResult as Record<string, unknown> | undefined;
    if (rs && resultObj) {
      const configOptions = parseConfigOptions(rs.agentType,resultObj);
      if (configOptions.length > 0) {
        rs.configOptions = configOptions;
        db.updateSessionConfigOptions(sessionId, configOptions);
        broadcast({ type: 'config_options_updated', sessionId, taskId, configOptions });
        console.info(`[acp] session ${sessionId} config options: ${configOptions.map(o => o.id).join(', ')}`);
      }
    }

    // Transition to ready (not running — waiting for first prompt)
    const extra: { external_session_id?: string } = {};
    if (acpSessionId) extra.external_session_id = acpSessionId;

    db.updateSessionState(sessionId, 'ready', extra);

    const session = db.getSession(sessionId)!;
    broadcast({ type: 'session_ready', taskId, session });

    // Re-derive task status now that session is ready (→ awaiting_input)
    if (taskId) deriveTaskStatus(taskId);

    console.info(`[acp] session ${sessionId} ready (ACP handshake done, supportsLoad=${supportsLoadSession})`);
  } catch (err) {
    if (!transport.isClosed) {
      console.error(`[acp] handshake error for session ${sessionId}:`, err);
    }
  }
}

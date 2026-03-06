/**
 * ACP (Agent Client Protocol) session manager.
 *
 * Spawns agent processes, performs the JSON-RPC 2.0 handshake
 * (initialize → session/new), waits for user prompt, then fires
 * session/prompt. Maps agent session/update notifications to
 * internal event types and handles graceful shutdown.
 *
 * Session lifecycle: starting → ready → running → stopped/crashed
 * - ready = process spawned + ACP handshake done, waiting for first prompt
 * - running = prompt turn in flight
 */

import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { randomUUID } from 'crypto';
import type { AgentCommand, AgentSession, AgentSessionState, AgentType, ApprovalDecision, ApprovalOption, PendingApproval, SessionConfigOption } from '@agemon/shared';
import { JsonRpcTransport } from './jsonrpc.ts';
import { AGENT_CONFIGS, buildAgentEnv, resolveAgentBinary } from './agents.ts';
import { gitManager } from './git.ts';

// ─── Config Option Parsing ───────────────────────────────────────────────────

/** Dispatch to the agent-specific config option parser. */
function parseConfigOptions(agentType: AgentType, result: Record<string, unknown>): SessionConfigOption[] {
  return AGENT_CONFIGS[agentType].parseConfigOptions(result);
}

// ─── Running Session State ───────────────────────────────────────────────────

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  transport: JsonRpcTransport;
  sessionId: string;
  taskId: string;
  agentType: AgentType;
  acpSessionId: string | null;
  turnInFlight: boolean;
  /** Stable ID for the current streaming message (accumulates chunks). */
  currentMessageId: string | null;
  currentMessageText: string;
  currentMessageType: 'thought' | 'action';
  /** Config options advertised by the agent (model, mode, etc.) */
  configOptions: SessionConfigOption[];
}

const sessions = new Map<string, RunningSession>();
const userStopped = new Set<string>(); // Track sessions stopped by user
const KILL_TIMEOUT_MS = 5_000;
const SHUTDOWN_REQUEST_TIMEOUT_MS = 3_000;

// ─── Pending Approval Resolver Registry ─────────────────────────────────────

const pendingApprovalResolvers = new Map<string, {
  resolve: (response: Record<string, unknown>) => void;
  sessionId: string;
  taskId: string;
}>();

// ─── Task Status Derivation ─────────────────────────────────────────────────

/**
 * Derive and update task status from the current state of all its sessions.
 * Called whenever a session state changes.
 */
function deriveTaskStatus(taskId: string): void {
  const task = db.getTask(taskId);
  if (!task || task.status === 'done') return; // don't override explicit done

  const taskSessions = db.listSessions(taskId);

  const runningSessions = taskSessions.filter(s => s.state === 'running');
  const hasRunning = runningSessions.length > 0;
  const hasReady = taskSessions.some(s => s.state === 'ready' || s.state === 'starting');
  const hasPendingInput = db.listPendingInputs(taskId).length > 0;

  // Check if any running session is actively processing a turn
  const anyTurnInFlight = runningSessions.some(s => {
    const rs = sessions.get(s.id);
    return rs?.turnInFlight === true;
  });

  let newStatus = task.status;
  if (hasRunning && anyTurnInFlight) {
    newStatus = 'working';
  } else if (hasRunning && !anyTurnInFlight) {
    // All running sessions idle — agent waiting for user's next message
    newStatus = 'awaiting_input';
  } else if (hasPendingInput) {
    newStatus = 'awaiting_input';
  } else if (hasReady) {
    // Sessions ready but none running — waiting for user's first prompt
    newStatus = 'awaiting_input';
  } else {
    // All sessions stopped/crashed — back to todo (user must mark done explicitly)
    newStatus = 'todo';
  }

  if (newStatus !== task.status) {
    db.updateTask(taskId, { status: newStatus });
    const updated = db.getTask(taskId);
    if (updated) broadcast({ type: 'task_updated', task: updated });
  }
}

// ─── ACP Handshake ──────────────────────────────────────────────────────────

/**
 * Run the ACP handshake only (initialize + session/new).
 * Transitions session to `ready` state — does NOT send a prompt.
 */
async function runAcpHandshake(
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string,
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
    const sessionResult = await transport.request('session/new', {
      cwd,
      mcpServers: [],
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
    deriveTaskStatus(taskId);

    console.info(`[acp] session ${sessionId} ready (ACP handshake done, supportsLoad=${supportsLoadSession})`);
  } catch (err) {
    if (!transport.isClosed) {
      console.error(`[acp] handshake error for session ${sessionId}:`, err);
    }
  }
}

// ─── Notification Handler ────────────────────────────────────────────────────

/**
 * Map ACP session/update notifications to internal event types and broadcast.
 */
function handleNotification(
  method: string,
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  // Handle session/update notifications from the agent
  if (method === 'session/update') {
    handleSessionUpdate(params, sessionId, taskId);
    return;
  }

  // Handle __raw__ (non-JSON-RPC output from the agent process)
  if (method === '__raw__') {
    const line =
      params && typeof params === 'object' && 'line' in (params as Record<string, unknown>)
        ? String((params as Record<string, unknown>).line)
        : String(params);

    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content: line,
    });
    broadcast({ type: 'agent_thought', taskId, sessionId, content: line, eventType: 'thought' });
    return;
  }

  // Unknown notification method — log as thought
  const content = JSON.stringify(params);
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'thought',
    content: `[${method}] ${content}`,
  });
  broadcast({ type: 'agent_thought', taskId, sessionId, content: `[${method}] ${content}`, eventType: 'thought' });
}

/**
 * Flush any accumulated streaming message to the database.
 * Called when a non-chunk update arrives or when the prompt turn completes.
 */
function flushCurrentMessage(sessionId: string, taskId: string): void {
  const rs = sessions.get(sessionId);
  if (!rs || !rs.currentMessageId || !rs.currentMessageText) return;

  db.insertEvent({
    id: rs.currentMessageId,
    task_id: taskId,
    session_id: sessionId,
    type: rs.currentMessageType,
    content: rs.currentMessageText,
  });

  rs.currentMessageId = null;
  rs.currentMessageText = '';
}

/**
 * Handle a session/update notification from the ACP agent.
 * The update contains a `sessionUpdate` field indicating the type.
 *
 * For streaming chunks (agent_message_chunk, agent_thought_chunk), we
 * accumulate text under a stable messageId and only persist to DB when
 * a non-chunk update arrives or the turn completes.
 */
function handleSessionUpdate(
  params: unknown,
  sessionId: string,
  taskId: string
): void {
  const obj = params as Record<string, unknown> | undefined;
  const update = obj?.update as Record<string, unknown> | undefined;
  if (!update || !('sessionUpdate' in update)) {
    return;
  }

  const updateType = update.sessionUpdate as string;
  const rs = sessions.get(sessionId);

  switch (updateType) {
    case 'agent_message_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      // Start a new streaming message if needed, or continue accumulating
      if (!rs.currentMessageId || rs.currentMessageType !== 'action') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'action';
      }
      rs.currentMessageText += text;

      // Broadcast the delta with a stable messageId so frontend can merge
      broadcast({
        type: 'agent_thought', taskId, sessionId, content: text,
        eventType: 'action', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'agent_thought_chunk': {
      const contentObj = update.content as { type?: string; text?: string } | undefined;
      const text = contentObj?.text ?? '';
      if (!text || !rs) return;

      if (!rs.currentMessageId || rs.currentMessageType !== 'thought') {
        flushCurrentMessage(sessionId, taskId);
        rs.currentMessageId = randomUUID();
        rs.currentMessageText = '';
        rs.currentMessageType = 'thought';
      }
      rs.currentMessageText += text;

      broadcast({
        type: 'agent_thought', taskId, sessionId, content: text,
        eventType: 'thought', messageId: rs.currentMessageId,
      });
      break;
    }

    case 'tool_call': {
      // Flush any pending streaming message before tool output
      flushCurrentMessage(sessionId, taskId);

      const toolCallId = (update.toolCallId as string) ?? '';
      const title = (update.title as string) ?? 'tool';
      const status = (update.status as string) ?? '';
      const content = toolCallId
        ? `[tool:${toolCallId}] ${title} (${status})`
        : `[tool] ${title} (${status})`;

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, sessionId, content, eventType: 'action' });
      break;
    }

    case 'tool_call_update': {
      const toolCallId = (update.toolCallId as string) ?? '';
      const status = (update.status as string) ?? '';
      if (!status) return;
      const content = `[tool update] ${toolCallId}: ${status}`;

      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'action',
        content,
      });
      broadcast({ type: 'agent_thought', taskId, sessionId, content, eventType: 'action' });
      break;
    }

    case 'config_options_update': {
      if (!rs) break;

      // Reuse the same parser — notification wraps configOptions the same way as session/new
      const parsed = parseConfigOptions(rs.agentType,update as Record<string, unknown>);
      if (parsed.length === 0) break;

      rs.configOptions = parsed;
      db.updateSessionConfigOptions(sessionId, rs.configOptions);
      broadcast({ type: 'config_options_updated', sessionId, taskId, configOptions: rs.configOptions });
      console.info(`[acp] session ${sessionId} config options updated: ${parsed.map(o => o.id).join(', ')}`);
      break;
    }

    case 'available_commands_update': {
      const commands = (update.availableCommands as AgentCommand[]) ?? [];
      broadcast({ type: 'available_commands', sessionId, taskId, commands });
      console.info(`[acp] session ${sessionId} available commands: ${commands.map(c => c.name).join(', ')}`);
      break;
    }

    default: {
      // Other update types (usage_update, etc.) — ignore silently
      break;
    }
  }
}

// ─── Process Exit Handler ────────────────────────────────────────────────────

async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string
): Promise<void> {
  const exitCode = await proc.exited;
  const state: AgentSessionState = exitCode === 0 ? 'stopped' : 'crashed';

  transport.close();

  // Deny all pending approvals for this session
  const pendingApprovals = db.listPendingApprovalsBySession(sessionId);
  for (const approval of pendingApprovals) {
    resolveApproval(approval.id, 'deny');
  }

  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);
  userStopped.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, taskId, state });

  // Derive task status from remaining sessions
  deriveTaskStatus(taskId);

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
}

// ─── Spawn Helpers ──────────────────────────────────────────────────────────

/**
 * Create the process, transport, and session map entry.
 * Returns the sessionId. Does NOT run the handshake.
 */
function spawnProcess(
  sessionId: string,
  taskId: string,
  agentType: AgentType
): RunningSession {
  const binaryPath = resolveAgentBinary(agentType);
  const config = AGENT_CONFIGS[agentType];
  const env = buildAgentEnv(agentType);
  const command = [binaryPath, ...config.command.slice(1)];

  const proc = Bun.spawn(command, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env,
  });

  db.updateSessionState(sessionId, 'starting', { pid: proc.pid });

  const transport = new JsonRpcTransport({
    stdin: proc.stdin,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    timeoutMs: 600_000,
  });

  // Register notification handler
  transport.onNotification((method, params) => {
    handleNotification(method, params, sessionId, taskId);
  });

  // Register incoming request handler (for agent -> client requests)
  transport.onRequest(async (method, params) => {
    if (method === 'requestPermission' || method === 'session/request_permission') {
      const reqParams = params as Record<string, unknown> | undefined;
      const options = (reqParams?.options ?? []) as Array<{ kind: string; optionId: string; label?: string; name?: string }>;

      // Extract tool context from the request
      const toolCall = reqParams?.toolCall as Record<string, unknown> | undefined;
      const toolName = extractToolName(toolCall);
      const toolTitle = (toolCall?.title as string) ?? toolName ?? 'Unknown tool';
      const context = extractToolContext(toolCall);

      // Check "Always Allow" rules first
      const rule = db.findApprovalRule(toolName, taskId, sessionId);
      if (rule) {
        const allowOption = options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always');
        if (allowOption) {
          console.info(`[acp] auto-approved (rule) ${toolName} for session ${sessionId}`);
          return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
        }
      }

      // Map ACP options to our ApprovalOption format
      const mappedOptions: ApprovalOption[] = options.map(o => ({
        kind: o.kind,
        optionId: o.optionId,
        label: o.label ?? o.name ?? o.kind.replace(/_/g, ' '),
      }));

      // Create pending approval
      const approvalId = randomUUID();
      const approval: PendingApproval = {
        id: approvalId,
        taskId,
        sessionId,
        toolName,
        toolTitle,
        context,
        options: mappedOptions,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.insertPendingApproval(approval);
      broadcast({ type: 'approval_requested', approval });

      // Block until user responds (Promise resolves in resolveApproval())
      return new Promise<Record<string, unknown>>((resolve) => {
        pendingApprovalResolvers.set(approvalId, { resolve, sessionId, taskId });
      });
    }

    console.info(`[acp] incoming request from agent: ${method}`, params);
    return {};
  });

  const rs: RunningSession = {
    proc, transport, sessionId, taskId, agentType, acpSessionId: null, turnInFlight: false,
    currentMessageId: null, currentMessageText: '', currentMessageType: 'action',
    configOptions: [],
  };

  sessions.set(sessionId, rs);

  // Monitor process exit
  handleExit(proc, transport, sessionId, taskId).catch((err) => {
    console.error(`[acp] handleExit error for session ${sessionId}:`, err);
  });

  return rs;
}

// ─── Tool Approval Helpers ───────────────────────────────────────────────

function extractToolName(toolCall: Record<string, unknown> | undefined): string {
  if (!toolCall) return 'unknown';
  // ACP sends `kind` as the tool type (e.g. "fetch", "bash", "edit")
  if (toolCall.kind && typeof toolCall.kind === 'string') return toolCall.kind;
  const meta = toolCall._meta as Record<string, unknown> | undefined;
  if (meta?.toolName) return meta.toolName as string;
  const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;
  if (rawInput?.tool) return rawInput.tool as string;
  const title = toolCall.title as string | undefined;
  if (title) return title.split(/[\s:]/)[0];
  return 'unknown';
}

function extractToolContext(toolCall: Record<string, unknown> | undefined): Record<string, string> {
  if (!toolCall) return {};
  const ctx: Record<string, string> = {};
  const input = toolCall.rawInput as Record<string, unknown> | undefined;
  if (input?.file_path) ctx.filePath = String(input.file_path);
  if (input?.command) ctx.command = String(input.command);
  if (input?.pattern) ctx.pattern = String(input.pattern);
  if (input?.path) ctx.path = String(input.path);
  if (input?.url) ctx.url = String(input.url);
  if (input?.content) ctx.preview = String(input.content).slice(0, 200);
  if (input?.old_string) ctx.oldString = String(input.old_string).slice(0, 200);
  if (input?.new_string) ctx.newString = String(input.new_string).slice(0, 200);
  if (toolCall.title) ctx.title = String(toolCall.title);
  return ctx;
}

/**
 * Resolve a pending tool approval. Called from the WebSocket handler
 * when the user clicks Allow Once / Always Allow / Deny.
 */
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision
): boolean {
  const pending = pendingApprovalResolvers.get(approvalId);
  if (!pending) return false;

  const approval = db.getPendingApproval(approvalId);
  if (!approval || approval.status !== 'pending') return false;

  // Find the matching ACP option
  const options = approval.options as ApprovalOption[];
  let selectedOption: ApprovalOption | undefined;

  if (decision === 'allow_once' || decision === 'allow_always') {
    selectedOption = options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always');
  } else {
    selectedOption = options.find(o => o.kind === 'deny' || o.kind === 'reject_once' || o.kind === 'reject_always');
  }

  // Update DB
  db.resolvePendingApproval(approvalId, decision);

  // Create "Always Allow" rule if requested
  if (decision === 'allow_always' && approval.toolName) {
    db.insertApprovalRule({
      id: randomUUID(),
      taskId: approval.taskId,
      sessionId: null, // Apply to all sessions in this task
      toolName: approval.toolName,
      createdAt: new Date().toISOString(),
    });
  }

  // Resolve the blocked Promise → unblocks the JSON-RPC response to agent
  if (selectedOption) {
    pending.resolve({ outcome: { outcome: 'selected', optionId: selectedOption.optionId } });
  } else {
    pending.resolve({ outcome: { outcome: 'cancelled' } });
  }

  pendingApprovalResolvers.delete(approvalId);
  broadcast({ type: 'approval_resolved', approvalId, decision });
  return true;
}

// ─── Exported API ────────────────────────────────────────────────────────────

/**
 * Spawn an ACP agent process for a task, run the handshake,
 * and transition to `ready` state. Does NOT send a prompt.
 * Returns the session in `starting` state (handshake is async).
 */
export function spawnAndHandshake(taskId: string, agentType: AgentType): AgentSession {
  const sessionId = randomUUID();

  db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  const task = db.getTask(taskId);
  if (!task) {
    db.updateSessionState(sessionId, 'crashed', { pid: null, exit_code: -1 });
    throw new Error(`Task ${taskId} not found`);
  }

  const rs = spawnProcess(sessionId, taskId, agentType);

  // Resolve working directory
  const agentCwd = task.repos.length > 0
    ? gitManager.getWorktreePath(taskId, task.repos[0].name)
    : process.cwd();

  // Run handshake asynchronously (transitions to ready)
  runAcpHandshake(rs.transport, sessionId, taskId, agentCwd).catch((err) => {
    console.error(`[acp] handshake error for session ${sessionId}:`, err);
  });

  return db.getSession(sessionId)!;
}

/**
 * Send a prompt turn to a session. Handles both first prompt (ready → running)
 * and follow-up prompts.
 * Throws if a turn is already in flight.
 */
export async function sendPromptTurn(sessionId: string, content: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) {
    throw new Error(`No active session found with id ${sessionId}`);
  }

  if (entry.turnInFlight) {
    throw new Error('Agent is still processing');
  }

  entry.turnInFlight = true;

  const sessionRecord = db.getSession(sessionId);
  if (sessionRecord) deriveTaskStatus(sessionRecord.task_id);
  if (!sessionRecord) {
    entry.turnInFlight = false;
    throw new Error(`Session ${sessionId} not found in database`);
  }
  const taskId = sessionRecord.task_id;

  // Store user message as an acp_event with type 'prompt'
  db.insertEvent({
    id: randomUUID(),
    task_id: taskId,
    session_id: sessionId,
    type: 'prompt',
    content,
  });

  if (!entry.acpSessionId) {
    entry.turnInFlight = false;
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  // If session is in `ready` state, transition to `running`
  if (sessionRecord.state === 'ready') {
    db.updateSessionState(sessionId, 'running');
    broadcast({
      type: 'session_state_changed',
      sessionId,
      taskId,
      state: 'running',
    });
    deriveTaskStatus(taskId);
  }

  // Set session name from first prompt (if not already named)
  const sessionForName = db.getSession(sessionId);
  if (sessionForName && !sessionForName.name) {
    const name = content.length > 50 ? content.slice(0, 47) + '...' : content;
    db.updateSessionName(sessionId, name);
  }

  try {
    await entry.transport.request('session/prompt', {
      sessionId: entry.acpSessionId,
      prompt: [{ type: 'text', text: content }],
    });
    console.info(`[acp] session ${sessionId} prompt turn completed`);
  } catch (err) {
    if (!entry.transport.isClosed) {
      console.error(`[acp] prompt turn error for session ${sessionId}:`, err);
    }
  } finally {
    flushCurrentMessage(sessionId, taskId);
    entry.turnInFlight = false;
    deriveTaskStatus(taskId);
  }
}

/**
 * Resume a stopped/crashed session by spawning a new process.
 * Attempts session/load if the agent supports it, falls back to session/new.
 */
export async function resumeSession(sessionId: string): Promise<AgentSession> {
  const sessionRecord = db.getSession(sessionId);
  if (!sessionRecord) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (sessionRecord.state !== 'stopped' && sessionRecord.state !== 'crashed') {
    throw new Error(`Session ${sessionId} is in state ${sessionRecord.state}, can only resume stopped or crashed sessions`);
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

  const agentCwd = task.repos.length > 0
    ? gitManager.getWorktreePath(taskId, task.repos[0].name)
    : process.cwd();

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
    if (supportsLoadSession && storedExternalId) {
      try {
        const loadResult = await rs.transport.request('session/load', {
          sessionId: storedExternalId,
          cwd: agentCwd,
          mcpServers: [],
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
        mcpServers: [],
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

/**
 * Set a config option on a running ACP session (e.g. change model).
 * Sends session/set_config_option to the agent process.
 */
export async function setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) {
    throw new Error(`No active session found with id ${sessionId}`);
  }
  if (!entry.acpSessionId) {
    throw new Error(`No ACP session ID for session ${sessionId}`);
  }

  await entry.transport.request('session/set_config_option', {
    sessionId: entry.acpSessionId,
    configOptionId: configId,
    value,
  });
}

/**
 * Get config options for a running session (from memory) or from DB for stopped sessions.
 */
export function getSessionConfigOptions(sessionId: string): SessionConfigOption[] {
  const entry = sessions.get(sessionId);
  if (entry) return entry.configOptions;
  return db.getSessionConfigOptions(sessionId) ?? [];
}

/**
 * Send a user's input response to the running agent via JSON-RPC.
 * Returns true if the message was sent, false if no active session was found.
 */
export function sendInputToAgent(sessionId: string, inputId: string, response: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry || entry.transport.isClosed) return false;

  entry.transport.notify('acp/inputResponse', { inputId, response });
  return true;
}

/**
 * Stop a running agent session.
 * Attempts a graceful JSON-RPC shutdown, then SIGTERM, then SIGKILL.
 */
export function stopAgent(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }

  userStopped.add(sessionId);

  // Attempt graceful JSON-RPC shutdown
  if (!entry.transport.isClosed) {
    entry.transport
      .request('shutdown', {})
      .then(() => {
        entry.transport.notify('exit');
      })
      .catch(() => {
        // Shutdown request failed — fall through to SIGTERM
      });
  }

  // SIGTERM as backup after giving shutdown request a moment
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      entry.proc.kill('SIGTERM');
    }
  }, SHUTDOWN_REQUEST_TIMEOUT_MS);

  // SIGKILL as final fallback
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      console.warn(`[acp] session ${sessionId} did not exit after SIGTERM, sending SIGKILL`);
      entry.proc.kill('SIGKILL');
    }
  }, KILL_TIMEOUT_MS);
}

/**
 * Get a running, ready, or starting session for a task.
 */
export function getActiveSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find((s) => s.state === 'running' || s.state === 'ready' || s.state === 'starting') ?? null;
}

/**
 * On server startup, mark any sessions that were running/starting/ready as interrupted.
 */
export function recoverInterruptedSessions(): void {
  for (const state of ['starting', 'ready', 'running'] as const) {
    const stateSessions = db.listSessionsByState(state);
    for (const session of stateSessions) {
      db.updateSessionState(session.id, 'interrupted', { pid: null });
      console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
    }
  }
}

/**
 * Gracefully shut down all running sessions. Called on SIGINT/SIGTERM.
 */
export async function shutdownAllSessions(): Promise<void> {
  const promises: Promise<number>[] = [];

  for (const [sessionId, entry] of sessions) {
    console.info(`[acp] shutting down session ${sessionId}`);

    // Try graceful JSON-RPC shutdown
    if (!entry.transport.isClosed) {
      entry.transport
        .request('shutdown', {})
        .then(() => entry.transport.notify('exit'))
        .catch(() => { /* fall through to SIGTERM */ });
    }

    entry.proc.kill('SIGTERM');
    promises.push(entry.proc.exited);
  }

  if (promises.length > 0) {
    await Promise.race([
      Promise.all(promises),
      new Promise<void>((resolve) => setTimeout(resolve, KILL_TIMEOUT_MS)),
    ]);

    // Force-kill any remaining sessions
    for (const [, entry] of sessions) {
      entry.proc.kill('SIGKILL');
    }
  }
}

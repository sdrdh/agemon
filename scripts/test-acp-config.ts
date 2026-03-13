#!/usr/bin/env bun
/**
 * ACP Event Probe — exercises a real ACP agent binary and validates all
 * session/update notification types that agemon parses, plus the data
 * returned by session/new and session/prompt.
 *
 * Usage:
 *   bun run scripts/test-acp-config.ts                           # claude-code (default)
 *   bun run scripts/test-acp-config.ts opencode acp              # opencode
 *   bun run scripts/test-acp-config.ts gemini --experimental-acp # gemini
 */

const BINARY = process.argv[2] || 'claude-agent-acp';
const ARGS = process.argv.slice(3);
const TIMEOUT_MS = 15_000;

// ─── JSON-RPC Transport ──────────────────────────────────────────────────────

let nextId = 1;
const decoder = new TextDecoder();
const pending = new Map<number, { resolve: (v: any) => void; method: string }>();

const proc = Bun.spawn([BINARY, ...ARGS], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
});

console.log(`[probe] Spawned ${BINARY} ${ARGS.join(' ')} (pid=${proc.pid})`);

function sendRequest(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  proc.stdin.write(msg);
  console.log(`[probe] → ${method} (id=${id})`);
  return new Promise((resolve) => {
    pending.set(id, { resolve, method });
  });
}

// ─── Event Collection ────────────────────────────────────────────────────────

/** All session/update types we expect to parse in acp.ts handleSessionUpdate */
const EXPECTED_UPDATE_TYPES = [
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'config_options_update',
  'available_commands_update',
  'usage_update',
] as const;

/** Fields we expect to extract from session/new result */
const SESSION_NEW_FIELDS = ['sessionId', 'configOptions', 'model'] as const;

/** Fields we expect to extract from session/prompt result */
const PROMPT_RESULT_FIELDS = ['stopReason', 'usage'] as const;

interface CollectedEvent {
  method: string;
  updateType?: string;
  params: unknown;
  timestamp: number;
}

const events: CollectedEvent[] = [];
const stderrLines: string[] = [];
let sessionNewResult: Record<string, unknown> | null = null;
let promptResult: Record<string, unknown> | null = null;

// ─── stdout reader ───────────────────────────────────────────────────────────

let buffer = '';

async function readOutput() {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);

          // Response to a pending request
          if (msg.id !== undefined && !msg.method) {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.resolve(msg.result ?? msg.error);
            }
            continue;
          }

          // Notification or agent→client request
          if (msg.method) {
            const updateType = msg.params?.update?.sessionUpdate as string | undefined;
            events.push({
              method: msg.method,
              updateType,
              params: msg.params,
              timestamp: Date.now(),
            });

            if (updateType) {
              const short = truncate(JSON.stringify(msg.params?.update), 200);
              console.log(`[probe] ← session/update: ${updateType}  ${short}`);
            } else {
              console.log(`[probe] ← ${msg.method}`);
            }
          }
        } catch {
          console.log(`[probe] ← (non-JSON): ${trimmed.slice(0, 120)}`);
        }
      }
    }
  } catch {}
}

async function readStderr() {
  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.trim()) {
          stderrLines.push(line.trim());
          console.log(`[probe] stderr: ${line.trim()}`);
        }
      }
    }
  } catch {}
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

readOutput();
readStderr();

// ─── Test Flow ───────────────────────────────────────────────────────────────

await Bun.sleep(500);

// Step 1: Initialize
console.log('\n── Step 1: initialize ──');
const initResult = await sendRequest('initialize', {
  protocolVersion: 1,
  clientInfo: { name: 'agemon-probe', version: '1.0.0' },
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
});

const capabilities = initResult?.capabilities as Record<string, unknown> | undefined;
console.log(`[probe] initialize result: supportsLoadSession=${!!capabilities?.loadSession}`);
console.log(`[probe] Full capabilities:`, JSON.stringify(capabilities, null, 2));

await Bun.sleep(1000);

// Step 2: session/new
console.log('\n── Step 2: session/new ──');
let sessionResult: any = null;
for (let attempt = 1; attempt <= 5; attempt++) {
  sessionResult = await sendRequest('session/new', {
    cwd: process.cwd(),
    mcpServers: [],
  });
  if (sessionResult?.sessionId) break;
  console.log(`[probe] session/new attempt ${attempt} failed (${sessionResult?.message ?? 'unknown'}), retrying in 3s...`);
  await Bun.sleep(3000);
}

sessionNewResult = sessionResult as Record<string, unknown>;
console.log(`[probe] session/new result keys: ${Object.keys(sessionNewResult ?? {}).join(', ')}`);
console.log(`[probe] session/new full result:`, JSON.stringify(sessionNewResult, null, 2));

const acpSessionId = sessionNewResult?.sessionId as string | undefined;
if (!acpSessionId) {
  console.error('[probe] FATAL: no sessionId in session/new result');
  proc.kill('SIGTERM');
  process.exit(1);
}

// Collect notifications that arrived during handshake (config_options, commands, etc.)
console.log(`[probe] Notifications so far: ${events.length}`);
await Bun.sleep(2000);
console.log(`[probe] Notifications after 2s wait: ${events.length}`);

// Step 3: session/prompt — triggers agent_message_chunk, tool_call, usage_update, etc.
console.log('\n── Step 3: session/prompt ──');
console.log('[probe] Sending prompt to exercise all event types...');
promptResult = await sendRequest('session/prompt', {
  sessionId: acpSessionId,
  prompt: [
    { type: 'text', text: 'Read the file "package.json" in the current directory and tell me the project name. Be brief.' },
  ],
}) as Record<string, unknown>;

console.log(`[probe] session/prompt result keys: ${Object.keys(promptResult ?? {}).join(', ')}`);
console.log(`[probe] session/prompt full result:`, JSON.stringify(promptResult, null, 2));

// Wait for any trailing notifications
console.log(`\n[probe] Waiting 5s for trailing notifications...`);
await Bun.sleep(5000);

// ─── Summary Report ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('  ACP EVENT PROBE SUMMARY');
console.log('='.repeat(70));

// 1. Notification methods seen
const methodCounts = new Map<string, number>();
for (const e of events) {
  methodCounts.set(e.method, (methodCounts.get(e.method) ?? 0) + 1);
}
console.log(`\n── Notification methods (${events.length} total) ──`);
for (const [method, count] of [...methodCounts].sort()) {
  console.log(`  ${method}: ${count}`);
}

// 2. session/update types seen
const updateTypeCounts = new Map<string, number>();
for (const e of events) {
  if (e.updateType) {
    updateTypeCounts.set(e.updateType, (updateTypeCounts.get(e.updateType) ?? 0) + 1);
  }
}
console.log(`\n── session/update types ──`);
for (const [type, count] of [...updateTypeCounts].sort()) {
  const expected = EXPECTED_UPDATE_TYPES.includes(type as any);
  console.log(`  ${expected ? '✓' : '?'} ${type}: ${count}`);
}

// 3. Check for missing expected types
const missing = EXPECTED_UPDATE_TYPES.filter(t => !updateTypeCounts.has(t));
if (missing.length > 0) {
  console.log(`\n── Missing expected update types ──`);
  for (const t of missing) {
    console.log(`  ✗ ${t} — never received`);
  }
} else {
  console.log(`\n  ✓ All expected update types received!`);
}

// 4. Unexpected update types
const unexpected = [...updateTypeCounts.keys()].filter(
  t => !EXPECTED_UPDATE_TYPES.includes(t as any)
);
if (unexpected.length > 0) {
  console.log(`\n── Unexpected update types (not parsed by agemon) ──`);
  for (const t of unexpected) {
    console.log(`  ! ${t}: ${updateTypeCounts.get(t)}`);
    // Print first example
    const example = events.find(e => e.updateType === t);
    if (example) {
      console.log(`    Example: ${truncate(JSON.stringify(example.params), 500)}`);
    }
  }
}

// 5. session/new result analysis
console.log(`\n── session/new result fields ──`);
if (sessionNewResult) {
  for (const key of Object.keys(sessionNewResult)) {
    const val = sessionNewResult[key];
    const expected = SESSION_NEW_FIELDS.includes(key as any);
    const display = typeof val === 'object' ? truncate(JSON.stringify(val), 120) : String(val);
    console.log(`  ${expected ? '✓' : '·'} ${key}: ${display}`);
  }
  const missingNew = SESSION_NEW_FIELDS.filter(f => !(f in sessionNewResult!));
  for (const f of missingNew) {
    console.log(`  ✗ ${f} — not present`);
  }
}

// 6. session/prompt result analysis
console.log(`\n── session/prompt result fields ──`);
if (promptResult) {
  for (const key of Object.keys(promptResult)) {
    const val = promptResult[key];
    const expected = PROMPT_RESULT_FIELDS.includes(key as any);
    const display = typeof val === 'object' ? truncate(JSON.stringify(val), 200) : String(val);
    console.log(`  ${expected ? '✓' : '·'} ${key}: ${display}`);
  }
  const missingPrompt = PROMPT_RESULT_FIELDS.filter(f => !(f in promptResult!));
  for (const f of missingPrompt) {
    console.log(`  ✗ ${f} — not present`);
  }

  // Detailed usage breakdown from prompt result
  const usage = promptResult.usage as Record<string, unknown> | undefined;
  if (usage) {
    console.log(`\n── session/prompt usage breakdown ──`);
    for (const [k, v] of Object.entries(usage)) {
      console.log(`    ${k}: ${v}`);
    }
  }
}

// 7. Sample events for each update type
console.log(`\n── Sample payloads (first of each type) ──`);
const seen = new Set<string>();
for (const e of events) {
  const key = e.updateType ?? e.method;
  if (seen.has(key)) continue;
  seen.add(key);
  const payload = e.updateType
    ? (e.params as any)?.update
    : e.params;
  console.log(`\n  [${key}]`);
  console.log(`  ${truncate(JSON.stringify(payload, null, 2), 600)}`);
}

// 8. Stderr summary
if (stderrLines.length > 0) {
  console.log(`\n── stderr (${stderrLines.length} lines) ──`);
  for (const line of stderrLines.slice(0, 10)) {
    console.log(`  ${line}`);
  }
  if (stderrLines.length > 10) {
    console.log(`  ... and ${stderrLines.length - 10} more`);
  }
}

console.log('\n' + '='.repeat(70));

// Cleanup
proc.kill('SIGTERM');
await Bun.sleep(500);
proc.kill('SIGKILL');
process.exit(0);

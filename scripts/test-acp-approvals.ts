#!/usr/bin/env bun
/**
 * ACP Approval Probe — spawns a real ACP agent, triggers a tool call that
 * requires approval (requestPermission), and dumps the full options payload
 * so we can see what labels the agent actually sends.
 *
 * Usage:
 *   bun run scripts/test-acp-approvals.ts                           # claude-code (default)
 *   bun run scripts/test-acp-approvals.ts opencode acp              # opencode
 *
 * The script sends a prompt that should trigger a Bash tool call, then
 * captures the requestPermission request from the agent and prints it.
 */

const BINARY = process.argv[2] || 'claude-agent-acp';
const ARGS = process.argv.slice(3);
const TIMEOUT_MS = 120_000;

// ─── JSON-RPC Transport ──────────────────────────────────────────────────────

let nextId = 1;
const decoder = new TextDecoder();
const pending = new Map<number, { resolve: (v: any) => void; method: string }>();
const incomingRequests: Array<{ id: number; method: string; params: unknown }> = [];

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

function sendResponse(id: number, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
  proc.stdin.write(msg);
  console.log(`[probe] → response (id=${id})`);
}

// ─── stdout reader ──────────────────────────────────────────────────────────

let buffer = '';
const permissionRequests: Array<{ id: number; params: unknown }> = [];
let gotPermissionRequest = false;

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

          // Response to our pending request
          if (msg.id !== undefined && !msg.method) {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.resolve(msg.result ?? msg.error);
            }
            continue;
          }

          // Agent→client request (e.g. requestPermission)
          if (msg.method && msg.id !== undefined) {
            console.log(`[probe] ← REQUEST: ${msg.method} (id=${msg.id})`);
            incomingRequests.push({ id: msg.id, method: msg.method, params: msg.params });

            if (msg.method === 'requestPermission' || msg.method === 'session/request_permission') {
              permissionRequests.push({ id: msg.id, params: msg.params });
              gotPermissionRequest = true;

              // Auto-allow so the agent can continue
              const options = (msg.params?.options ?? []) as Array<{ kind: string; optionId: string }>;
              const allowOption = options.find(o => o.kind === 'allow_once');
              if (allowOption) {
                sendResponse(msg.id, { outcome: { outcome: 'selected', optionId: allowOption.optionId } });
              } else {
                sendResponse(msg.id, { outcome: { outcome: 'cancelled' } });
              }
            }
            continue;
          }

          // Notification
          if (msg.method) {
            const updateType = msg.params?.update?.sessionUpdate;
            if (updateType === 'tool_call' || updateType === 'tool_call_update') {
              const tc = msg.params?.update;
              console.log(`[probe] ← ${updateType}: ${tc?.toolCall?.kind ?? tc?.kind ?? '?'} ${(tc?.toolCall?.title ?? tc?.title ?? '').slice(0, 60)}`);
            } else if (updateType) {
              console.log(`[probe] ← session/update: ${updateType}`);
            } else {
              console.log(`[probe] ← ${msg.method}`);
            }
          }
        } catch {
          // non-JSON
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
        if (line.trim()) console.log(`[probe] stderr: ${line.trim()}`);
      }
    }
  } catch {}
}

readOutput();
readStderr();

// ─── Test Flow ──────────────────────────────────────────────────────────────

await Bun.sleep(500);

// Step 1: Initialize
console.log('\n── Step 1: initialize ──');
const initResult = await sendRequest('initialize', {
  protocolVersion: 1,
  clientInfo: { name: 'agemon-approval-probe', version: '1.0.0' },
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
});
console.log(`[probe] initialize result:`, JSON.stringify(initResult, null, 2));

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
  console.log(`[probe] session/new attempt ${attempt} failed, retrying in 3s...`);
  await Bun.sleep(3000);
}

const acpSessionId = sessionResult?.sessionId as string | undefined;
if (!acpSessionId) {
  console.error('[probe] FATAL: no sessionId in session/new result');
  proc.kill('SIGTERM');
  process.exit(1);
}
console.log(`[probe] Got sessionId: ${acpSessionId}`);

await Bun.sleep(2000);

// Step 3: Send a prompt that should trigger tool calls requiring approval.
// We use multi-step tasks involving git, file writes, and bash to maximize
// the chance of hitting a permission gate.
console.log('\n── Step 3: session/prompt (trigger approval) ──');
console.log('[probe] Sending prompt designed to trigger multiple tool approvals...');

const promptResult = await Promise.race([
  sendRequest('session/prompt', {
    sessionId: acpSessionId,
    prompt: [
      {
        type: 'text',
        text: `Do ALL of the following steps in order. Do NOT skip any step. Do NOT ask for confirmation, just do them:

1. Run: git branch -a
2. Run: git log --oneline -5
3. Run: curl -s https://httpbin.org/get | head -5
4. Write a file called /tmp/agemon-approval-test.txt with the content "test"
5. Run: cat /tmp/agemon-approval-test.txt
6. Run: rm /tmp/agemon-approval-test.txt

Execute each step. Do not explain, just run the commands.`,
      },
    ],
  }),
  Bun.sleep(TIMEOUT_MS).then(() => ({ timeout: true })),
]);

if (promptResult && typeof promptResult === 'object' && 'timeout' in promptResult) {
  console.log('[probe] Prompt timed out (this is OK if we got permission requests)');
}

// Wait a bit for any trailing events
await Bun.sleep(3000);

// ─── Approval Report ────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('  ACP APPROVAL PROBE RESULTS');
console.log('='.repeat(70));

if (permissionRequests.length === 0) {
  console.log('\n  ✗ No requestPermission calls received!');
  console.log('    The agent may have auto-approved, or the prompt did not trigger a tool call.');
  console.log(`\n  Total incoming requests: ${incomingRequests.length}`);
  for (const req of incomingRequests) {
    console.log(`    ${req.method} (id=${req.id})`);
  }
} else {
  console.log(`\n  ✓ Received ${permissionRequests.length} requestPermission call(s)\n`);

  for (let i = 0; i < permissionRequests.length; i++) {
    const req = permissionRequests[i];
    const params = req.params as Record<string, unknown>;

    console.log(`── Permission Request #${i + 1} ──`);
    console.log(`  Full params:\n${JSON.stringify(params, null, 2)}`);

    // Extract and display options specifically
    const options = (params?.options ?? []) as Array<Record<string, unknown>>;
    console.log(`\n  Options (${options.length}):`);
    for (const opt of options) {
      console.log(`    kind:     ${opt.kind}`);
      console.log(`    optionId: ${opt.optionId}`);
      console.log(`    label:    ${opt.label ?? '(not set)'}`);
      console.log(`    name:     ${opt.name ?? '(not set)'}`);
      // Print all keys in case there are extra fields
      const extraKeys = Object.keys(opt).filter(k => !['kind', 'optionId', 'label', 'name'].includes(k));
      if (extraKeys.length > 0) {
        console.log(`    extra:    ${extraKeys.map(k => `${k}=${JSON.stringify(opt[k])}`).join(', ')}`);
      }
      console.log('    ---');
    }

    // Extract tool call info
    const toolCall = params?.toolCall as Record<string, unknown> | undefined;
    if (toolCall) {
      console.log(`\n  Tool call:`);
      console.log(`    kind:     ${toolCall.kind ?? '(not set)'}`);
      console.log(`    title:    ${toolCall.title ?? '(not set)'}`);
      const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;
      if (rawInput) {
        console.log(`    rawInput: ${JSON.stringify(rawInput, null, 6)}`);
      }
      const meta = toolCall._meta as Record<string, unknown> | undefined;
      if (meta) {
        console.log(`    _meta:    ${JSON.stringify(meta, null, 6)}`);
      }
    }
    console.log('');
  }
}

// Also show all incoming request methods seen
if (incomingRequests.length > permissionRequests.length) {
  console.log(`\n── Other incoming requests from agent ──`);
  for (const req of incomingRequests) {
    if (req.method !== 'requestPermission' && req.method !== 'session/request_permission') {
      console.log(`  ${req.method} (id=${req.id})`);
      console.log(`  params: ${JSON.stringify(req.params, null, 4).slice(0, 500)}`);
    }
  }
}

console.log('\n' + '='.repeat(70));

// Cleanup
proc.kill('SIGTERM');
await Bun.sleep(500);
proc.kill('SIGKILL');
process.exit(0);

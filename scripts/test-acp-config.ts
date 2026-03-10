#!/usr/bin/env bun
/**
 * Probe the real claude-agent-acp binary to see what notifications it sends,
 * specifically looking for config_options_update.
 *
 * Usage: bun run scripts/test-acp-config.ts
 */

// Usage:
//   bun run scripts/test-acp-config.ts                           # claude-code (default)
//   bun run scripts/test-acp-config.ts opencode acp              # opencode
//   bun run scripts/test-acp-config.ts gemini --experimental-acp # gemini
const BINARY = process.argv[2] || 'claude-agent-acp';
const ARGS = process.argv.length > 3 ? process.argv.slice(3) : ['--agent', 'claude-code'];
const TIMEOUT_MS = 10_000;

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

const allNotifications: any[] = [];
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

          // Response to a request
          if (msg.id !== undefined && !msg.method) {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.resolve(msg.result ?? msg.error);
            }
            continue;
          }

          // Notification
          if (msg.method) {
            allNotifications.push(msg);
            const updateType = msg.params?.update?.sessionUpdate;
            if (updateType) {
              console.log(`[probe] ← session/update: ${updateType}`);
              if (updateType.includes('config') || updateType.includes('usage')) {
                console.log(JSON.stringify(msg.params, null, 2));
              }
            } else {
              console.log(`[probe] ← ${msg.method}`);
              // Print incoming requests (agent -> client) in full
              if (msg.id !== undefined) {
                console.log(`  (agent request, id=${msg.id})`, JSON.stringify(msg.params).slice(0, 300));
              }
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
        if (line.trim()) console.log(`[probe] stderr: ${line.trim()}`);
      }
    }
  } catch {}
}

readOutput();
readStderr();

await Bun.sleep(500);

// Step 1: Initialize
const initResult = await sendRequest('initialize', {
  protocolVersion: 1,
  clientInfo: { name: 'agemon-probe', version: '1.0.0' },
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
});

console.log(`[probe] initialize result:`, JSON.stringify(initResult, null, 2));

await Bun.sleep(1000);

// Step 2: session/new
const sessionResult = await sendRequest('session/new', {
  cwd: process.cwd(),
  mcpServers: [],
});

console.log(`[probe] session/new result:`, JSON.stringify(sessionResult, null, 2));

if (sessionResult?.code) {
  console.log('[probe] session/new failed, trying without mcpServers...');
  const retry = await sendRequest('session/new', { cwd: process.cwd() });
  console.log(`[probe] retry result:`, JSON.stringify(retry, null, 2));
}

// Send a simple prompt to trigger usage_update
console.log('[probe] Sending a prompt to trigger usage_update...');
const promptResult = await sendRequest('session/prompt', {
  sessionId: sessionResult.sessionId,
  prompt: [
    { type: 'text', text: 'Say "hello" and nothing else.' }
  ],
});

console.log('[probe] Prompt result:', JSON.stringify(promptResult, null, 2));

console.log(`[probe] Waiting ${TIMEOUT_MS / 1000}s for notifications...`);
await Bun.sleep(TIMEOUT_MS);

// Summary
console.log('\n========== SUMMARY ==========');
console.log(`Total notifications: ${allNotifications.length}`);

const updateTypes = allNotifications
  .filter((m: any) => m.method === 'session/update')
  .map((m: any) => m.params?.update?.sessionUpdate)
  .filter(Boolean);

const methods = [...new Set(allNotifications.map((m: any) => m.method))];
console.log(`Notification methods: ${methods.join(', ') || '(none)'}`);
console.log(`session/update types: ${[...new Set(updateTypes)].join(', ') || '(none)'}`);

const configRelated = allNotifications.filter((m: any) => {
  const str = JSON.stringify(m).toLowerCase();
  return str.includes('config') || str.includes('model');
});

if (configRelated.length > 0) {
  console.log(`\nConfig/model-related messages (${configRelated.length}):`);
  for (const m of configRelated) {
    console.log(JSON.stringify(m, null, 2));
  }
} else {
  console.log('\nNo config or model-related messages found.');
  console.log('\nAll notifications:');
  for (const m of allNotifications) {
    console.log(JSON.stringify(m, null, 2).slice(0, 500));
  }
}

proc.kill('SIGTERM');
await Bun.sleep(500);
proc.kill('SIGKILL');
process.exit(0);

#!/usr/bin/env bun
/**
 * Fake ACP agent that responds to the JSON-RPC handshake and sends
 * config_options_update notifications. Used for testing config option
 * flow without a real agent binary.
 *
 * Usage: bun run scripts/fake-acp-agent.ts
 *
 * This script reads JSON-RPC messages from stdin and writes responses
 * to stdout, exactly like a real ACP agent would.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let acpSessionId: string | null = null;

function send(msg: Record<string, unknown>) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
}

function sendNotification(method: string, params: unknown) {
  send({ jsonrpc: '2.0', method, params });
}

function sendResponse(id: number, result: unknown) {
  send({ jsonrpc: '2.0', id, result });
}

function sendConfigOptionsUpdate() {
  if (!acpSessionId) return;

  sendNotification('session/update', {
    sessionId: acpSessionId,
    update: {
      sessionUpdate: 'config_options_update',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          description: 'The AI model to use',
          category: 'model',
          type: 'select',
          currentValue: 'claude-sonnet-4-20250514',
          options: [
            { value: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { value: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
            { value: 'claude-haiku-4-20250514', name: 'Claude Haiku 4' },
          ],
        },
        {
          id: 'mode',
          name: 'Mode',
          description: 'Operating mode',
          category: 'mode',
          type: 'select',
          currentValue: 'code',
          options: [
            { value: 'code', name: 'Code' },
            { value: 'chat', name: 'Chat' },
            { value: 'architect', name: 'Architect' },
          ],
        },
      ],
    },
  });
}

function handleMessage(msg: Record<string, unknown>) {
  const method = msg.method as string;
  const id = msg.id as number | undefined;

  switch (method) {
    case 'initialize': {
      sendResponse(id!, {
        protocolVersion: 1,
        serverInfo: { name: 'fake-acp-agent', version: '1.0.0' },
        capabilities: { loadSession: false },
      });
      break;
    }

    case 'session/new': {
      acpSessionId = `fake-session-${Date.now()}`;
      sendResponse(id!, { sessionId: acpSessionId });

      // Send config options shortly after session is created
      setTimeout(() => sendConfigOptionsUpdate(), 200);
      break;
    }

    case 'session/prompt': {
      // Simulate agent thinking
      sendNotification('session/update', {
        sessionId: acpSessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking about your request...\n' },
        },
      });

      setTimeout(() => {
        sendNotification('session/update', {
          sessionId: acpSessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'I received your message. Config options should be visible in the UI.\n' },
          },
        });
        // Complete the prompt turn
        sendResponse(id!, { status: 'completed' });
      }, 500);
      break;
    }

    case 'session/set_config_option': {
      const params = msg.params as Record<string, unknown>;
      const configId = params.configId as string;
      const value = params.value as string;
      console.error(`[fake-agent] Config option set: ${configId} = ${value}`);

      sendResponse(id!, { status: 'ok' });

      // Re-send config options with updated value
      setTimeout(() => {
        // Update the current value in our mock data
        sendNotification('session/update', {
          sessionId: acpSessionId,
          update: {
            sessionUpdate: 'config_options_update',
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: configId === 'model' ? value : 'claude-sonnet-4-20250514',
                options: [
                  { value: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
                  { value: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
                  { value: 'claude-haiku-4-20250514', name: 'Claude Haiku 4' },
                ],
              },
              {
                id: 'mode',
                name: 'Mode',
                category: 'mode',
                type: 'select',
                currentValue: configId === 'mode' ? value : 'code',
                options: [
                  { value: 'code', name: 'Code' },
                  { value: 'chat', name: 'Chat' },
                  { value: 'architect', name: 'Architect' },
                ],
              },
            ],
          },
        });
      }, 100);
      break;
    }

    case 'shutdown': {
      sendResponse(id!, {});
      break;
    }

    case 'exit': {
      process.exit(0);
    }

    default: {
      if (id !== undefined) {
        sendResponse(id, {});
      }
    }
  }
}

// Read newline-delimited JSON-RPC from stdin
let buffer = '';
process.stdin.on('data', (chunk: Buffer) => {
  buffer += decoder.decode(chunk);
  const lines = buffer.split('\n');
  buffer = lines.pop()!; // keep incomplete last line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg);
    } catch {
      console.error(`[fake-agent] Failed to parse: ${trimmed}`);
    }
  }
});

process.stdin.resume();
console.error('[fake-agent] Started, waiting for JSON-RPC messages on stdin...');

import { describe, test, expect, mock } from 'bun:test';
import { JsonRpcTransport } from './jsonrpc.ts';

const decoder = new TextDecoder();

/** Extract the JSON message from a mock call arg (Uint8Array). */
function parseWriteCall(arg: unknown): Record<string, unknown> {
  const text = arg instanceof Uint8Array ? decoder.decode(arg) : String(arg);
  return JSON.parse(text);
}

describe('JsonRpcTransport', () => {
  test('generates sequential request IDs', async () => {
    const { readable, writable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
      timeoutMs: 100,
    });

    // Make requests without awaiting (they'll timeout, but we just want to check IDs)
    transport.request('method1').catch(() => {});
    transport.request('method2').catch(() => {});

    expect(stdin.write).toHaveBeenCalledTimes(2);
    const call1 = parseWriteCall(stdin.write.mock.calls[0][0]);
    const call2 = parseWriteCall(stdin.write.mock.calls[1][0]);

    expect(call1.id).toBe(1);
    expect(call2.id).toBe(2);

    transport.close();
  });

  test('rejects requests when transport is closed', async () => {
    const { readable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
    });

    transport.close();

    await expect(transport.request('test')).rejects.toThrow('Transport is closed');
  });

  test('ignores notifications after close', () => {
    const { readable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
    });

    transport.close();
    transport.notify('test'); // Should not throw

    expect(stdin.write).not.toHaveBeenCalled();
  });

  test('requests timeout when no response received', async () => {
    const { readable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
      timeoutMs: 50,
    });

    await expect(transport.request('slow-method')).rejects.toThrow('timed out');

    transport.close();
  });

  test('dispatches notifications to registered handlers', async () => {
    const handler = mock(() => {});

    const { readable, writable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
    });

    transport.onNotification(handler);

    // Simulate incoming notification
    const writer = writable.getWriter();
    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'test/notification', params: { foo: 'bar' } }) + '\n';
    await writer.write(new TextEncoder().encode(notification));

    // Give the read loop time to process
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith('test/notification', { foo: 'bar' });

    transport.close();
  });

  test('formats request messages correctly', () => {
    const { readable } = new TransformStream();
    const stdin = { write: mock(() => 0) };

    const transport = new JsonRpcTransport({
      stdin,
      stdout: readable as ReadableStream<Uint8Array>,
      timeoutMs: 100,
    });

    transport.request('initialize', { version: 1 }).catch(() => {});

    const msg = parseWriteCall(stdin.write.mock.calls[0][0]);

    expect(msg).toMatchObject({
      jsonrpc: '2.0',
      id: expect.any(Number),
      method: 'initialize',
      params: { version: 1 },
    });

    transport.close();
  });
});

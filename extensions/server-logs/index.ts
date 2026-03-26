import { Hono } from 'hono';
import type { ExtensionContext, ExtensionExports } from '../../backend/src/lib/extensions/types.ts';

const UNIT = 'agemon';

export function onLoad(_ctx: ExtensionContext): ExtensionExports {
  const api = new Hono();

  // GET /history?lines=200  — recent log lines (one-shot)
  api.get('/history', async (c) => {
    const lines = Math.min(Number(c.req.query('lines') ?? '200'), 2000);
    const proc = Bun.spawn(
      ['journalctl', '-u', UNIT, '--no-pager', '-n', String(lines), '-o', 'short-iso'],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return c.text(text);
  });

  // GET /stream  — SSE tail (journalctl -f)
  api.get('/stream', (c) => {
    const proc = Bun.spawn(
      ['journalctl', '-u', UNIT, '--no-pager', '-f', '-n', '0', '-o', 'short-iso'],
      { stdout: 'pipe', stderr: 'pipe' }
    );

    const stream = new ReadableStream({
      async start(controller) {
        const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (line.trim()) {
                controller.enqueue(`data: ${JSON.stringify(line)}\n\n`);
              }
            }
          }
        } catch {
          // stream closed
        } finally {
          controller.close();
        }
      },
      cancel() {
        try { proc.kill(); } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  return {
    apiRoutes: api,
    pages: [
      { path: '/', component: 'logs-view' },
    ],
  };
}

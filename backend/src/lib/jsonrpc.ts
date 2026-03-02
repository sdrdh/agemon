/**
 * JSON-RPC 2.0 transport over stdin/stdout (newline-delimited).
 *
 * Handles:
 * - Request/response correlation by auto-incrementing id
 * - Notifications (messages without id)
 * - Incoming requests from agent (agent -> client)
 * - Configurable request timeouts
 * - Raw line passthrough for non-JSON-RPC output
 */

// ─── JSON-RPC 2.0 Message Types ─────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ─── Handler Types ───────────────────────────────────────────────────────────

export type NotificationHandler = (method: string, params: unknown) => void;
export type RequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

// ─── Pending Request Tracking ────────────────────────────────────────────────

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Transport Options ───────────────────────────────────────────────────────

export interface JsonRpcTransportOptions {
  /** Writable stdin from Bun.spawn */
  stdin: { write(data: Uint8Array | string): number | Promise<number> };
  /** Readable stdout from Bun.spawn */
  stdout: ReadableStream<Uint8Array>;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

// ─── Transport Class ─────────────────────────────────────────────────────────

export class JsonRpcTransport {
  private _nextId = 1;
  private _pending = new Map<number, PendingRequest>();
  private _notificationHandlers: NotificationHandler[] = [];
  private _requestHandler: RequestHandler | null = null;
  private _closed = false;
  private _timeoutMs: number;
  private _stdin: JsonRpcTransportOptions['stdin'];
  private _encoder = new TextEncoder();
  private _readLoopPromise: Promise<void>;

  constructor(options: JsonRpcTransportOptions) {
    this._stdin = options.stdin;
    this._timeoutMs = options.timeoutMs ?? 30_000;
    this._readLoopPromise = this._readLoop(options.stdout);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Send a JSON-RPC request and await the correlated response.
   * Rejects if the transport is closed, the request times out,
   * or the agent returns an error response.
   */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this._closed) {
      return Promise.reject(new Error('Transport is closed'));
    }

    const id = this._nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method} (id=${id})`));
      }, this._timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      this._send(msg);
    });
  }

  /**
   * Send a JSON-RPC notification (fire-and-forget, no response expected).
   */
  notify(method: string, params?: unknown): void {
    if (this._closed) return;

    const msg: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    this._send(msg);
  }

  /**
   * Register a handler for incoming notifications from the agent.
   * Multiple handlers can be registered; all are called for each notification.
   */
  onNotification(handler: NotificationHandler): void {
    this._notificationHandlers.push(handler);
  }

  /**
   * Register a handler for incoming requests from the agent.
   * Only one handler is supported. The handler's return value (or resolved
   * promise) is sent back as the result. If no handler is registered,
   * a method-not-found error is returned.
   */
  onRequest(handler: RequestHandler): void {
    this._requestHandler = handler;
  }

  /**
   * Close the transport: reject all pending requests, stop reading.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;

    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Transport closed'));
      this._pending.delete(id);
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private _send(msg: JsonRpcMessage): void {
    const line = JSON.stringify(msg) + '\n';
    try {
      this._stdin.write(this._encoder.encode(line));
    } catch {
      // stdin may already be closed if process exited
    }
  }

  private async _readLoop(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this._closed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          this._handleLine(line);
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        this._handleLine(buffer);
      }
    } catch (err) {
      if (!this._closed) {
        console.error('[jsonrpc] read loop error:', err);
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  private _handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not valid JSON — emit as raw output
      this._dispatchNotification('__raw__', { line });
      return;
    }

    // Must be a JSON-RPC 2.0 message
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>).jsonrpc !== '2.0'
    ) {
      // Valid JSON but not JSON-RPC — emit as raw
      this._dispatchNotification('__raw__', { line });
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // ── Response (has id + result/error, no method) ──
    if ('id' in msg && typeof msg.id === 'number' && !('method' in msg)) {
      this._handleResponse(msg as unknown as JsonRpcResponse);
      return;
    }

    // ── Request (has id + method) ──
    if ('id' in msg && typeof msg.id === 'number' && 'method' in msg && typeof msg.method === 'string') {
      this._handleIncomingRequest(msg as unknown as JsonRpcRequest);
      return;
    }

    // ── Notification (has method, no id) ──
    if ('method' in msg && typeof msg.method === 'string' && !('id' in msg)) {
      const notification = msg as unknown as JsonRpcNotification;
      this._dispatchNotification(notification.method, notification.params);
      return;
    }

    // Unrecognized structure — emit as raw
    this._dispatchNotification('__raw__', { line });
  }

  private _handleResponse(response: JsonRpcResponse): void {
    const pending = this._pending.get(response.id);
    if (!pending) {
      console.warn(`[jsonrpc] received response for unknown id: ${response.id}`);
      return;
    }

    this._pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private async _handleIncomingRequest(request: JsonRpcRequest): Promise<void> {
    if (!this._requestHandler) {
      // No handler registered — return method not found
      this._send({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          message: `Method not found: ${request.method}`,
        },
      } as JsonRpcResponse);
      return;
    }

    try {
      const result = await this._requestHandler(request.method, request.params);
      this._send({
        jsonrpc: '2.0',
        id: request.id,
        result: result ?? null,
      } as JsonRpcResponse);
    } catch (err) {
      this._send({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      } as JsonRpcResponse);
    }
  }

  private _dispatchNotification(method: string, params: unknown): void {
    for (const handler of this._notificationHandlers) {
      try {
        handler(method, params);
      } catch (err) {
        console.error(`[jsonrpc] notification handler error (${method}):`, err);
      }
    }
  }
}

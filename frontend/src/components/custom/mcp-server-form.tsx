import { useState, useEffect } from 'react';
import { Plus, X, Globe, Terminal, Loader2, CheckCircle2, AlertCircle, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { McpServerConfig, McpToolInfo } from '@agemon/shared';

type TransportType = 'stdio' | 'http';
type TestStatus = 'idle' | 'checking' | 'connected' | 'error';

export function AddMcpServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const [transport, setTransport] = useState<TransportType>('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testTools, setTestTools] = useState<McpToolInfo[] | null>(null);

  const isValid = name.trim() && (transport === 'stdio' ? command.trim() : url.trim());

  // Reset test status when inputs change
  useEffect(() => {
    setTestStatus('idle');
    setTestMessage('');
    setTestLatency(null);
    setTestTools(null);
  }, [transport, command, args, url, headers]);

  function buildConfig(): McpServerConfig {
    const trimmedName = name.trim() || 'test';
    return transport === 'stdio'
      ? { name: trimmedName, command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : undefined }
      : { type: 'http' as const, name: trimmedName, url: url.trim(), ...(headers.some(h => h.name.trim()) ? { headers: headers.filter(h => h.name.trim()) } : {}) };
  }

  async function handleTest() {
    setTestStatus('checking');
    setTestMessage('');
    setTestLatency(null);
    setTestTools(null);
    try {
      const result = await api.testMcpServer({ config: buildConfig() });
      setTestStatus(result.status);
      setTestMessage(result.message);
      setTestLatency(result.latencyMs);
      setTestTools(result.tools ?? null);
    } catch (err) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : 'Test failed');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError('');
    try {
      const config = buildConfig();
      await onAdd(name.trim(), config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 rounded-md border border-dashed bg-muted/30">
      <div>
        <Input
          placeholder="Server name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm"
          autoFocus
        />
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setTransport('stdio')}
          className={`flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium min-h-[44px] transition-colors ${
            transport === 'stdio' ? 'bg-background text-foreground shadow-sm border' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Terminal className="h-3 w-3" />
          stdio
        </button>
        <button
          type="button"
          onClick={() => setTransport('http')}
          className={`flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium min-h-[44px] transition-colors ${
            transport === 'http' ? 'bg-background text-foreground shadow-sm border' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe className="h-3 w-3" />
          http
        </button>
      </div>

      {transport === 'stdio' ? (
        <div className="space-y-2">
          <Input
            placeholder="Command (e.g. npx)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="text-sm font-mono"
          />
          <Input
            placeholder="Args (space-separated, e.g. -y @context7/mcp)"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="text-sm font-mono"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="URL (e.g. https://...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="text-sm font-mono"
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Headers</label>
              <button
                type="button"
                onClick={() => setHeaders([...headers, { name: '', value: '' }])}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
            {headers.map((header, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <Input
                  placeholder="Header name"
                  value={header.name}
                  onChange={(e) => {
                    const updated = [...headers];
                    updated[i] = { ...updated[i], name: e.target.value };
                    setHeaders(updated);
                  }}
                  className="text-sm font-mono flex-1"
                />
                <Input
                  placeholder="Value"
                  value={header.value}
                  onChange={(e) => {
                    const updated = [...headers];
                    updated[i] = { ...updated[i], value: e.target.value };
                    setHeaders(updated);
                  }}
                  className="text-sm font-mono flex-1"
                />
                <button
                  type="button"
                  onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection test */}
      {isValid && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testStatus === 'checking'}
            onClick={handleTest}
            className="w-full"
          >
            {testStatus === 'checking' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Wifi className="h-3.5 w-3.5 mr-1.5" />
            )}
            {testStatus === 'checking' ? 'Testing...' : 'Test Connection'}
          </Button>

          {testStatus === 'connected' && (
            <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-2 rounded-md space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{testMessage}</span>
                {testLatency !== null && (
                  <span className="shrink-0 text-muted-foreground">{testLatency}ms</span>
                )}
              </div>
              {testTools && testTools.length > 0 && (
                <div className="text-muted-foreground pl-5.5">
                  {testTools.length} tool{testTools.length !== 1 ? 's' : ''} available
                </div>
              )}
            </div>
          )}

          {testStatus === 'error' && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{testMessage}</span>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={!isValid || submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

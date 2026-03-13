import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { McpServerItem } from '@/components/custom/mcp-server-item';
import { AddMcpServerForm } from '@/components/custom/mcp-server-form';
import { api } from '@/lib/api';
import type { McpServerEntry, McpServerConfig } from '@agemon/shared';

export function McpServerList({
  scope,
  taskId,
}: {
  scope: 'global' | 'task';
  taskId?: string;
}) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [globalServers, setGlobalServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    try {
      if (scope === 'global') {
        setServers(await api.listGlobalMcpServers());
      } else if (taskId) {
        const result = await api.listTaskMcpServers(taskId);
        setServers(result.task);
        setGlobalServers(result.global);
      }
    } catch {
      // silently fail — empty list
    } finally {
      setLoading(false);
    }
  }, [scope, taskId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(name: string, config: McpServerConfig) {
    if (scope === 'global') {
      await api.addGlobalMcpServer({ name, config });
    } else if (taskId) {
      await api.addTaskMcpServer(taskId, { name, config });
    }
    setShowAdd(false);
    await load();
  }

  async function handleDelete(entry: McpServerEntry) {
    setDeleteError('');
    try {
      if (scope === 'global') {
        await api.removeGlobalMcpServer(entry.id);
      } else if (taskId) {
        await api.removeTaskMcpServer(taskId, entry.id);
      }
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAny = servers.length > 0 || globalServers.length > 0;

  return (
    <div className="space-y-3">
      {/* Inherited global servers (task scope only) */}
      {scope === 'task' && globalServers.length > 0 && (
        <div className="space-y-1.5 opacity-60">
          {globalServers.map((entry) => (
            <McpServerItem key={entry.id} entry={entry} readOnly />
          ))}
        </div>
      )}

      {/* Scoped servers */}
      {servers.length > 0 && (
        <div className="space-y-1.5">
          {servers.map((entry) => (
            <McpServerItem key={entry.id} entry={entry} onDelete={() => handleDelete(entry)} />
          ))}
        </div>
      )}

      {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

      {!hasAny && !showAdd && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No MCP servers configured
        </p>
      )}

      {showAdd ? (
        <AddMcpServerForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} />
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowAdd(true)}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add MCP Server
        </Button>
      )}
    </div>
  );
}

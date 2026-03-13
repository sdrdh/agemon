import { getDb } from './client.ts';
import { mapMcpServer, type RawMcpServer } from './helpers.ts';
import type { McpServerConfig, McpServerEntry } from '@agemon/shared';

export function addMcpServer(id: string, name: string, taskId: string | null, config: McpServerConfig): McpServerEntry {
  const database = getDb();
  database.run(
    'INSERT INTO mcp_servers (id, name, task_id, config) VALUES (?, ?, ?, ?)',
    [id, name, taskId, JSON.stringify(config)]
  );
  const row = database.query<RawMcpServer, [string]>(
    'SELECT * FROM mcp_servers WHERE id = ?'
  ).get(id)!;
  return mapMcpServer(row);
}

export function removeMcpServer(id: string): boolean {
  const database = getDb();
  const result = database.run('DELETE FROM mcp_servers WHERE id = ?', [id]);
  return result.changes > 0;
}

export function getMcpServer(id: string): McpServerEntry | null {
  const row = getDb().query<RawMcpServer, [string]>(
    'SELECT * FROM mcp_servers WHERE id = ?'
  ).get(id);
  return row ? mapMcpServer(row) : null;
}

export function listGlobalMcpServers(): McpServerEntry[] {
  return getDb().query<RawMcpServer, []>(
    'SELECT * FROM mcp_servers WHERE task_id IS NULL ORDER BY name'
  ).all().map(mapMcpServer);
}

export function listTaskMcpServers(taskId: string): McpServerEntry[] {
  return getDb().query<RawMcpServer, [string]>(
    'SELECT * FROM mcp_servers WHERE task_id = ? ORDER BY name'
  ).all(taskId).map(mapMcpServer);
}

/** Merge global + task-level MCP servers. Task overrides global by name. */
export function getMergedMcpServers(taskId: string): McpServerConfig[] {
  const globals = listGlobalMcpServers();
  const taskServers = listTaskMcpServers(taskId);
  const taskNames = new Set(taskServers.map(s => s.name));
  const merged: McpServerConfig[] = [];
  // Add globals that aren't overridden by task-level
  for (const g of globals) {
    if (!taskNames.has(g.name)) merged.push(g.config);
  }
  // Add all task-level servers
  for (const t of taskServers) {
    merged.push(t.config);
  }
  return merged;
}

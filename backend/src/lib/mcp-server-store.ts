/**
 * MCP server configurations stored as ~/.agemon/mcp-servers.json.
 * Supports global servers (taskId=null) and per-task overrides.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { AGEMON_DIR } from './git.ts';
import type { McpServerConfig, McpServerEntry } from '@agemon/shared';

// ─── Module State ─────────────────────────────────────────────────────────────

let _servers: McpServerEntry[] = [];

function getStorePath(): string {
  return join(AGEMON_DIR, 'mcp-servers.json');
}

// ─── Startup Loading ──────────────────────────────────────────────────────────

export function loadMcpServers(): void {
  const path = getStorePath();
  if (!existsSync(path)) return;
  try {
    _servers = JSON.parse(readFileSync(path, 'utf8'));
    if (_servers.length > 0) {
      console.info(`[mcp-servers] loaded ${_servers.length} server(s)`);
    }
  } catch (err) {
    console.warn(`[mcp-servers] failed to load:`, (err as Error).message);
    _servers = [];
  }
}

function flush(): void {
  atomicWriteJsonSync(getStorePath(), _servers);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function addMcpServer(
  id: string,
  name: string,
  taskId: string | null,
  config: McpServerConfig
): McpServerEntry {
  const entry: McpServerEntry = {
    id,
    name,
    scope: taskId ? 'task' : 'global',
    taskId,
    config,
    createdAt: new Date().toISOString(),
  };
  _servers.push(entry);
  flush();
  return entry;
}

export function removeMcpServer(id: string): boolean {
  const idx = _servers.findIndex(s => s.id === id);
  if (idx === -1) return false;
  _servers.splice(idx, 1);
  flush();
  return true;
}

export function getMcpServer(id: string): McpServerEntry | null {
  return _servers.find(s => s.id === id) ?? null;
}

export function listGlobalMcpServers(): McpServerEntry[] {
  return _servers
    .filter(s => s.taskId === null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listTaskMcpServers(taskId: string): McpServerEntry[] {
  return _servers
    .filter(s => s.taskId === taskId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Merge global + task-level MCP servers. Task overrides global by name. */
export function getMergedMcpServers(taskId: string): McpServerConfig[] {
  const globals = listGlobalMcpServers();
  const taskServers = listTaskMcpServers(taskId);
  const taskNames = new Set(taskServers.map(s => s.name));
  const merged: McpServerConfig[] = [];
  for (const g of globals) {
    if (!taskNames.has(g.name)) merged.push(g.config);
  }
  for (const t of taskServers) {
    merged.push(t.config);
  }
  return merged;
}

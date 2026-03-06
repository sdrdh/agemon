import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { registerTools } from './tools.ts';

let mcpServer: McpServer | null = null;
let transport: StreamableHTTPTransport | null = null;

export function getMcpServer(): McpServer {
  if (!mcpServer) {
    mcpServer = new McpServer({
      name: 'agemon',
      version: '1.0.0',
    });
    registerTools(mcpServer);
  }
  return mcpServer;
}

export function getMcpTransport(): StreamableHTTPTransport {
  if (!transport) {
    // sessionIdGenerator: undefined disables MCP session tracking — each request
    // is stateless. Agemon manages its own sessions via the agent_sessions table.
    transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  }
  return transport;
}

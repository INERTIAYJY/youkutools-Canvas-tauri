/**
 * MCP bridge、工具描述和调用结果的跨前后端协议类型。
 */
import type { AgentToolSchema } from '../services/chat/agentToolSchemas';

export type McpTransport = 'stdio' | 'streamable-http';

export interface McpBridgeSessionInfo {
  sessionId: string;
  port: number;
  transport: McpTransport;
  bindAddress: '127.0.0.1' | '0.0.0.0';
  endpointPath?: '/mcp';
  adapterPath?: string;
}

export interface McpBridgeRequestEvent {
  sessionId: string;
  requestId: string;
  method: 'tools/list' | 'tools/call' | 'requests/cancel';
  params: Record<string, unknown>;
}

export interface McpBridgeResponseInput {
  sessionId: string;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: AgentToolSchema;
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' };

export interface McpToolCallResult {
  isError: boolean;
  summary: string;
  content: McpContent[];
}

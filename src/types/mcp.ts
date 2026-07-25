/**
 * MCP bridge、工具描述和调用结果的跨前后端协议类型。
 */
import type { AgentToolSchema } from '../services/chat/agentToolSchemas';

export interface McpBridgeSessionInfo {
  sessionId: string;
  port: number;
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

export interface McpToolCallResult {
  isError: boolean;
  summary: string;
  content: Array<{ type: 'text'; text: string }>;
}

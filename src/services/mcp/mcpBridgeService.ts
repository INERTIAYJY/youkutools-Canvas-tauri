/**
 * 封装 MCP Tauri bridge 的启动、停止、状态查询、响应回传和请求事件监听。
 */
import type {
  McpBridgeRequestEvent,
  McpBridgeResponseInput,
  McpBridgeSessionInfo,
} from '../../types/mcp';
import { invoke } from '@tauri-apps/api/core';

/** port 省略时由系统分配随机回环端口。 */
export async function startMcpBridge(
  token: string,
  port?: number,
): Promise<McpBridgeSessionInfo> {
  return invoke<McpBridgeSessionInfo>('mcp_bridge_start', { token, port: port ?? null });
}

export async function stopMcpBridge(): Promise<void> {
  await invoke('mcp_bridge_stop');
}

export async function getMcpBridgeStatus(): Promise<McpBridgeSessionInfo | null> {
  return invoke<McpBridgeSessionInfo | null>('mcp_bridge_status');
}

export async function respondToMcpBridge(response: McpBridgeResponseInput): Promise<void> {
  await invoke('mcp_bridge_respond', { response });
}

export async function listenForMcpBridgeRequests(
  handler: (request: McpBridgeRequestEvent) => void | Promise<void>,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<McpBridgeRequestEvent>('mcp:request', (event) => {
    void handler(event.payload);
  });
}

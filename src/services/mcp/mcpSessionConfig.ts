/**
 * 管理 MCP 会话令牌（固定令牌存凭据存储，不落 IndexedDB）与本地服务启动命令。
 */
import type { McpBridgeSessionInfo, McpTransport } from '../../types/mcp';
import { readAppSecret, writeAppSecret } from '../providerSecretService';
import { useAppStore } from '../../store/useAppStore';
import { startMcpBridge } from './mcpBridgeService';

/** 凭据存储条目名；字符集须与 Rust 侧 validate_key 对齐。 */
const MCP_TOKEN_SECRET_KEY = 'mcp/token';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function generateMcpSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 取出固定令牌，没有就生成一个并写进凭据存储。
 * 凭据存储不可用时退回一次性令牌，只在本次会话内有效。
 */
export async function ensureMcpSessionToken(): Promise<string> {
  const stored = (await readAppSecret(MCP_TOKEN_SECRET_KEY))?.toLowerCase();
  if (stored && TOKEN_PATTERN.test(stored)) return stored;
  const token = generateMcpSessionToken();
  await writeAppSecret(MCP_TOKEN_SECRET_KEY, token);
  return token;
}

/** 令牌泄露或需要作废旧客户端配置时轮换。 */
export async function rotateMcpSessionToken(): Promise<string> {
  const token = generateMcpSessionToken();
  await writeAppSecret(MCP_TOKEN_SECRET_KEY, token);
  return token;
}

/** 端口非法（含 0、特权端口）时按随机端口处理。 */
export function normalizeMcpPort(value: unknown): number | undefined {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  return port;
}

export function getConfiguredMcpTransport(value: unknown): McpTransport {
  return value === 'streamable-http' ? 'streamable-http' : 'stdio';
}

/** 按用户配置（固定端口 + 固定令牌）开启 bridge。 */
export async function startConfiguredMcpBridge(): Promise<{
  session: McpBridgeSessionInfo;
  token: string;
}> {
  const token = await ensureMcpSessionToken();
  const config = useAppStore.getState().config;
  const port = normalizeMcpPort(config.mcpPort);
  const transport = getConfiguredMcpTransport(config.mcpTransport);
  const session = await startMcpBridge(token, port, transport);
  return { session, token };
}

export function buildMcpHttpEndpoint(session: McpBridgeSessionInfo): string | null {
  if (session.transport !== 'streamable-http') return null;
  return `http://<AI_CANVAS_IP>:${session.port}${session.endpointPath ?? '/mcp'}`;
}

/**
 * 生成客户端配置片段（Claude Desktop / Cursor 等的 mcpServers 格式）。
 * stdio 令牌走 env 而不是命令行参数；HTTP 令牌按标准 Bearer header 发送。
 */
export function buildMcpClientConfig(
  session: McpBridgeSessionInfo,
  token: string,
): string | null {
  if (session.transport === 'streamable-http') {
    const endpoint = buildMcpHttpEndpoint(session);
    if (!endpoint) return null;
    return JSON.stringify(
      {
        mcpServers: {
          'ai-canvas': {
            url: endpoint,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
      null,
      2,
    );
  }
  if (!session.adapterPath) return null;
  return JSON.stringify(
    {
      mcpServers: {
        'ai-canvas': {
          command: 'node',
          args: [session.adapterPath, '--port', String(session.port)],
          env: { AI_CANVAS_MCP_TOKEN: token },
        },
      },
    },
    null,
    2,
  );
}

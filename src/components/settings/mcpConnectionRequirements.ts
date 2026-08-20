import type { McpTransport } from '../../types/mcp';

export const MCP_CONNECTION_REQUIREMENTS = [
  {
    icon: 'lucide:app-window',
    title: 'AI Canvas 桌面端',
    description: '软件需保持运行，并开启上方“本地控制会话”。',
  },
  {
    icon: 'lucide:terminal',
    title: 'Node.js 运行环境',
    description: '需已安装 Node.js，且系统可直接运行 node 命令。',
  },
  {
    icon: 'lucide:plug-zap',
    title: '支持 MCP 的客户端',
    description: '客户端需支持 stdio 类型的 MCP 服务配置，例如 Claude Desktop、Cursor 或 Codex。',
  },
  {
    icon: 'lucide:monitor',
    title: '在同一台电脑连接',
    description: '控制服务只监听 127.0.0.1，不能从局域网或其他电脑远程连接。',
  },
] as const;

export const MCP_HTTP_CONNECTION_REQUIREMENTS = [
  {
    icon: 'lucide:app-window',
    title: 'AI Canvas 桌面端',
    description: '软件需保持运行，并开启上方“远程控制会话”。',
  },
  {
    icon: 'lucide:network',
    title: '可达的局域网地址',
    description: '客户端需能访问这台电脑的局域网 IP 和所选端口，防火墙也需放行。',
  },
  {
    icon: 'lucide:plug-zap',
    title: '支持 Streamable HTTP',
    description: '客户端需支持 Streamable HTTP MCP，并允许配置 Authorization 请求头。',
  },
  {
    icon: 'lucide:key-round',
    title: 'Bearer Token 鉴权',
    description: '每次请求都必须携带本机凭据存储中的 256 位令牌。',
  },
] as const;

export function getMcpConnectionRequirements(transport: McpTransport) {
  return transport === 'streamable-http'
    ? MCP_HTTP_CONNECTION_REQUIREMENTS
    : MCP_CONNECTION_REQUIREMENTS;
}

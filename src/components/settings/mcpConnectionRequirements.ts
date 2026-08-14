/**
 * settings/mcpConnectionRequirements — MCP 控制会话的前置条件说明。
 * 以图标 + 标题 + 描述的形式列出开启本地控制会话所需的软硬件条件
 * （桌面端运行、Node.js、支持 stdio 的 MCP 客户端、同机回环连接）。
 */
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

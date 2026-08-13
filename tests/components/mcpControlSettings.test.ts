import { describe, expect, it } from 'vitest';
import {
  buildMcpClientConfig,
  generateMcpSessionToken,
  normalizeMcpPort,
} from '../../src/services/mcp/mcpSessionConfig';
import { MCP_CONNECTION_REQUIREMENTS } from '../../src/components/settings/mcpConnectionRequirements';

describe('MCP control settings helpers', () => {
  it('lists the complete local connection environment requirements', () => {
    expect(MCP_CONNECTION_REQUIREMENTS.map((requirement) => requirement.title)).toEqual([
      'AI Canvas 桌面端',
      'Node.js 运行环境',
      '支持 MCP 的客户端',
      '在同一台电脑连接',
    ]);
    expect(MCP_CONNECTION_REQUIREMENTS.at(-1)?.description).toContain('127.0.0.1');
  });

  it('generates a fresh 256-bit hexadecimal session token', () => {
    const first = generateMcpSessionToken();
    const second = generateMcpSessionToken();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it('builds a client config with the token in env, only when the adapter exists', () => {
    const token = 'ab'.repeat(32);
    const config = buildMcpClientConfig({
      sessionId: 'session-1',
      port: 43123,
      adapterPath: 'D:\\AI Canvas\\scripts\\ai-canvas-mcp.mjs',
    }, token);

    expect(JSON.parse(config ?? '')).toEqual({
      mcpServers: {
        'ai-canvas': {
          command: 'node',
          args: ['D:\\AI Canvas\\scripts\\ai-canvas-mcp.mjs', '--port', '43123'],
          env: { AI_CANVAS_MCP_TOKEN: token },
        },
      },
    });
    // 令牌不能出现在命令行参数里：argv 对本机所有进程可见
    expect(JSON.parse(config ?? '').mcpServers['ai-canvas'].args.join(' ')).not.toContain(token);

    expect(buildMcpClientConfig({ sessionId: 'session-1', port: 43123 }, token)).toBeNull();
  });

  it('accepts only user-assignable ports as the fixed port', () => {
    expect(normalizeMcpPort('43123')).toBe(43123);
    expect(normalizeMcpPort(1024)).toBe(1024);
    expect(normalizeMcpPort(65535)).toBe(65535);
    // 非法输入一律回落到随机端口，而不是把 0 / 特权端口传给 bridge
    expect(normalizeMcpPort(80)).toBeUndefined();
    expect(normalizeMcpPort(70000)).toBeUndefined();
    expect(normalizeMcpPort('abc')).toBeUndefined();
    expect(normalizeMcpPort('')).toBeUndefined();
    expect(normalizeMcpPort(undefined)).toBeUndefined();
  });
});

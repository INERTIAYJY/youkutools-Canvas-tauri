import { describe, expect, it } from 'vitest';
// 生产适配器是直接由 Node 执行的 ESM 脚本，不参与应用 TypeScript 构建。
// @ts-expect-error JavaScript MCP 适配器没有独立声明文件
import { toMcpToolResult } from '../../../scripts/ai-canvas-mcp.mjs';

describe('MCP image result adapter', () => {
  it('preserves image content returned by AI Canvas', () => {
    expect(toMcpToolResult({
      isError: false,
      content: [{ type: 'image', data: 'YWJj', mimeType: 'image/jpeg' }],
    })).toEqual({
      isError: false,
      content: [{ type: 'image', data: 'YWJj', mimeType: 'image/jpeg' }],
    });
  });
});

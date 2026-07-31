import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 提及/引用编辑器把提示词文本渲染成芯片 DOM。提示词来自项目数据、Agent 写入和
 * 粘贴内容，属于不可信输入：一旦用 innerHTML 拼接，构造闭合标签 + 事件属性即可执行脚本。
 *
 * 这些模块依赖 React / Tauri，node 测试环境无法直接 import，因此在源码层面钉住约束：
 * innerHTML 只允许用于清空（赋值 ''），任何拼接都必须改用 createElement + textContent。
 */
const EDITOR_SOURCES = [
  'src/components/nodes/shared/MentionEditor.tsx',
  'src/components/nodes/shared/mentionEditorDom.ts',
  'src/components/chat/ChatComposerEditor.tsx',
  'src/components/nodes/shared/PresetManager.tsx',
];

function readSource(relativePath: string): string {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

describe('rich text chip rendering stays injection-free', () => {
  it.each(EDITOR_SOURCES)('%s only uses innerHTML to clear content', (relativePath) => {
    const source = readSource(relativePath);
    const assignments = [...source.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)]
      .map((match) => match[1].trim());

    // 断言正则确实还能匹配到赋值，避免文件改写后这条测试变成空跑
    expect(assignments.length).toBeGreaterThan(0);
    for (const value of assignments) {
      expect(value).toBe("''");
    }
  });

  it.each(EDITOR_SOURCES)('%s does not use other HTML sinks', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).not.toContain('outerHTML =');
    expect(source).not.toContain('insertAdjacentHTML');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders the workflow chip id through a text node, not markup', () => {
    const source = readSource('src/components/nodes/shared/mentionEditorDom.ts');
    const chipBuilder = source.slice(
      source.indexOf('function buildWorkflowChipEl('),
      source.indexOf('function renderPromptToNodes('),
    );

    expect(chipBuilder).toContain('buildChipTextEl');
    expect(chipBuilder).not.toMatch(/\.innerHTML\s*=/);
    // id 只能进 textContent 或 setAttribute，不能出现在任何 HTML 字符串里
    expect(chipBuilder).toMatch(/buildChipTextEl\('prompt-chip-wf-id', `#\$\{ioNodeId\}`\)/);
  });
});

/**
 * promptTextReferences — 视频/图片节点 @ 文本类节点引用的提示词合并测试。
 * 覆盖 ai-text / source-text / ai-markdown 三类文本节点的展开，确保
 * 导入文本与补充提示词同时保留进入生成环节。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { resolvePromptWithMediaRefs } from '../../src/services/ai/promptResolver';
import { resolveNodeReferences } from '../../src/services/nodeReferenceService';
import type { BaseNodeData, NodeType } from '../../src/types';

function textNode(id: string, nodeType: NodeType, label: string, output: string) {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: { type: nodeType, label, output } as BaseNodeData,
  };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('视频节点 @ 文本节点 + 补充提示词', () => {
  it('source-text 引用保留文本内容与补充提示词', async () => {
    useAppStore.setState({
      nodes: [textNode('text-1', 'source-text', '剧本', '主角是一个勇敢的机器人，在废墟中寻找希望。')],
    });
    const result = await resolvePromptWithMediaRefs('@{text-1:剧本} 补充：镜头缓慢推进，暖色调');
    expect(result.prompt).toContain('主角是一个勇敢的机器人，在废墟中寻找希望。');
    expect(result.prompt).toContain('镜头缓慢推进');
  });

  it('ai-text 引用保留文本内容与补充提示词', async () => {
    useAppStore.setState({
      nodes: [textNode('text-2', 'ai-text', '设定', '世界观：反乌托邦未来都市。')],
    });
    const result = await resolvePromptWithMediaRefs('@{text-2:设定} 补充：高角度俯拍');
    expect(result.prompt).toContain('世界观：反乌托邦未来都市。');
    expect(result.prompt).toContain('高角度俯拍');
  });

  it('ai-markdown 节点引用展开文本内容（回归：此前返回空导致文本丢失）', async () => {
    useAppStore.setState({
      nodes: [textNode('md-1', 'ai-markdown', '剧本', '第一幕：雨夜，侦探进入废弃剧院。')],
    });
    const result = await resolvePromptWithMediaRefs('@{md-1:剧本} 补充：冷色调，低机位');
    expect(result.prompt).toContain('第一幕：雨夜，侦探进入废弃剧院。');
    expect(result.prompt).toContain('补充：冷色调，低机位');
  });

  it('resolveNodeReferences 对文本类节点按 data.output 展开', () => {
    useAppStore.setState({
      nodes: [textNode('text-3', 'source-text', '设定', '世界观：反乌托邦未来都市。')],
    });
    const resolved = resolveNodeReferences('@{text-3:设定} 补充：高角度俯拍');
    expect(resolved).toContain('世界观：反乌托邦未来都市。');
    expect(resolved).toContain('高角度俯拍');
  });

  it('长文本引用不被截断', async () => {
    const longText = '这是一个很长很长' + '的内容'.repeat(500);
    useAppStore.setState({
      nodes: [textNode('text-4', 'source-text', '长文本', longText)],
    });
    const result = await resolvePromptWithMediaRefs('@{text-4:长文本} 简短补充');
    expect(result.prompt).toContain('的内容'.repeat(500));
    expect(result.prompt.length).toBeGreaterThan(longText.length);
  });
});

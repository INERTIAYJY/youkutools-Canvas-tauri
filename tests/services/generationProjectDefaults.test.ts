/**
 * generationProjectDefaults — 回归测试：未选择模型的 %s 节点提交项目默认工作流。
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { BaseNodeData } from '../../src/types';

const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn(), audio: vi.fn() }));
vi.mock('../../src/services/aiService', () => ({
  generateImage: mocks.image, generateVideo: mocks.video, generateAudio: mocks.audio,
}));
import { useAppStore } from '../../src/store/useAppStore';
import { executeGeneration } from '../../src/services/generationService';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  for (const mock of Object.values(mocks)) mock.mockReset().mockRejectedValue(new Error('停止于提交边界'));
  useAppStore.setState({
    currentProjectId: 'project', projectLoadStatus: 'ready', showToast: vi.fn(), recordOutputHistory: vi.fn(),
    projects: [{ id: 'project', name: '项目', createdAt: 1, updatedAt: 1, settings: {
      defaultModels: { image: 'comfyui/image', video: 'comfyui/video', audio: 'comfyui/audio' },
    } }],
  });
});

it.each(['image', 'video', 'audio'] as const)('未选择模型的 %s 节点提交项目默认工作流', async (kind) => {
  const data: BaseNodeData = { type: `ai-${kind}`, label: '节点', prompt: '生成内容', provider: 'general' };
  useAppStore.setState({ nodes: [{ id: 'node', type: data.type, position: { x: 0, y: 0 }, data }] });
  await executeGeneration('node');
  expect(mocks[kind]).toHaveBeenCalledWith(expect.objectContaining({
    model: 'comfyui/workflow', provider: 'comfyui', workflowId: kind,
  }));
});

it.each(['image', 'video', 'audio'] as const)('明确选择的 %s 模型不被项目工作流覆盖', async (kind) => {
  const data: BaseNodeData = { type: `ai-${kind}`, label: '节点', prompt: '生成内容', model: 'general/explicit', provider: 'general' };
  useAppStore.setState({ nodes: [{ id: 'node', type: data.type, position: { x: 0, y: 0 }, data }] });
  await executeGeneration('node');
  expect(mocks[kind]).toHaveBeenCalledWith(expect.objectContaining({
    model: 'general/explicit', provider: 'general', workflowId: undefined,
  }));
});

it.each(['image', 'video', 'audio'] as const)('通过 Store 新建 %s 节点后生成仍使用继承的工作流', async (kind) => {
  useAppStore.getState().addNode({ id: 'node', type: `ai-${kind}`, position: { x: 0, y: 0 },
    data: { type: `ai-${kind}`, label: '节点', model: 'general/application-default' } });
  expect(useAppStore.getState().nodes[0].data).toMatchObject({
    model: 'comfyui/workflow', provider: 'comfyui', workflowId: kind,
  });
  await executeGeneration('node', '生成内容');
  expect(mocks[kind]).toHaveBeenCalledWith(expect.objectContaining({
    model: 'comfyui/workflow', provider: 'comfyui', workflowId: kind,
  }));
});

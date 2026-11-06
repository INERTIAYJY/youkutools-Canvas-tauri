/**
 * projectSettingsService — 回归测试：assistant text model candidates。
 */
import { describe, expect, it } from 'vitest';
import {
  getAssistantTextModelCandidates,
  normalizeProjectSettings,
  applyProjectDefaultsToNodeData,
  getProjectComfyWorkflowOptions,
  parseProjectModelRef,
} from '../../src/services/projectSettingsService';
import type { BaseNodeData, WorkflowDefinition } from '../../src/types';

describe('assistant text model candidates', () => {
  it('prefers the project text default and keeps the application model as fallback', () => {
    expect(getAssistantTextModelCandidates({
      defaultModels: { text: 'general/project-model' },
    }, 'general/application-model')).toEqual([
      'general/project-model',
      'general/application-model',
    ]);
  });

  it('trims values, removes duplicates and supports projects without a default', () => {
    expect(getAssistantTextModelCandidates({
      defaultModels: { text: ' general/shared-model ' },
    }, 'general/shared-model')).toEqual(['general/shared-model']);
    expect(getAssistantTextModelCandidates(undefined, 'general/application-model'))
      .toEqual(['general/application-model']);
  });
});

describe('project visual model settings', () => {
  it('normalizes the vision model and only persists an enabled auto-routing flag', () => {
    expect(normalizeProjectSettings({
      visionModelId: ' general/vision-model ',
      modelAutoRouting: true,
    })).toMatchObject({
      visionModelId: 'general/vision-model',
      modelAutoRouting: true,
    });
    expect(normalizeProjectSettings({ visionModelId: ' ', modelAutoRouting: false }))
      .toEqual({});
  });
});

describe('项目默认 ComfyUI 工作流', () => {
  const workflows: WorkflowDefinition[] = [
    { id: 'image', name: '图片工作流', category: 'ai-image', adapterType: 'comfyui' },
    { id: 'legacy', name: '旧视频工作流', category: 'ai-video' },
    { id: 'audio', name: '音频工作流', category: 'ai-audio', adapterType: 'comfyui' },
    { id: 'text', name: '文本工作流', category: 'ai-text' },
    { id: 'cloud', name: '云工作流', category: 'ai-video', adapterType: 'runninghub' },
    { id: 'api', name: 'API 工作流', category: 'ai-video', adapterType: 'workflow-api' },
  ].map((item) => ({ ...item, fileName: 'workflow.json', fileContent: '{}', createdAt: 1 }) as WorkflowDefinition);

  it('按媒体类型列出本地工作流，兼容旧定义并排除文本及云工作流', () => {
    expect(getProjectComfyWorkflowOptions('image', workflows)).toEqual([{ value: 'comfyui/image', label: '图片工作流' }]);
    expect(getProjectComfyWorkflowOptions('video', workflows)).toEqual([{ value: 'comfyui/legacy', label: '旧视频工作流' }]);
    expect(getProjectComfyWorkflowOptions('audio', workflows)).toEqual([{ value: 'comfyui/audio', label: '音频工作流' }]);
    expect(getProjectComfyWorkflowOptions('text', workflows)).toEqual([]);
    expect(getProjectComfyWorkflowOptions('image', [])).toEqual([]);
  });

  it('保存工作流引用并解析为生成需要的工作流 ID', () => {
    const saved = normalizeProjectSettings({ defaultModels: { image: ' comfyui/image ' } });
    expect(saved.defaultModels?.image).toBe('comfyui/image');
    expect(parseProjectModelRef(saved.defaultModels?.image)).toEqual({
      model: 'comfyui/workflow', provider: 'comfyui', workflowId: 'image',
    });
    expect(parseProjectModelRef('comfyui/')).toBeNull();
  });

  it.each(['image', 'video', 'audio'] as const)('新建 %s 节点继承工作流且清除旧输入绑定', (kind) => {
    const data: BaseNodeData = { type: `ai-${kind}`, label: '节点', model: 'general/old',
      workflowId: 'old', workflowInputs: { old: '旧参数' }, batchCount: 4 };
    const result = applyProjectDefaultsToNodeData(data, { defaultModels: { [kind]: `comfyui/${kind}` } });
    expect(result).toMatchObject({ model: 'comfyui/workflow', provider: 'comfyui', workflowId: kind, batchCount: 1 });
    expect(result.workflowInputs).toBeUndefined();
    expect(data.workflowId).toBe('old');
  });

  it('普通模型默认值清除旧工作流绑定，已填写提示词的模型和已存在节点保持原值', () => {
    const data: BaseNodeData = { type: 'ai-image', label: '节点', model: 'comfyui/workflow', provider: 'comfyui', workflowId: 'image' };
    const settings = { defaultModels: { image: 'general/new' } };
    expect(applyProjectDefaultsToNodeData(data, settings).workflowId).toBeUndefined();
    for (const explicit of [{ ...data, prompt: '已编辑' }, { ...data, displayId: 1 }, { ...data, role: 'source' as const }]) {
      expect(applyProjectDefaultsToNodeData(explicit, settings)).toEqual(explicit);
    }
  });
});

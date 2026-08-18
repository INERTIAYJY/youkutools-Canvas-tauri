import { describe, expect, it } from 'vitest';
import { createPresetNode } from '../../src/components/nodes/shared/toolbar/presetAction';
import type { BaseNodeData } from '../../src/types';

const source = (data: Partial<BaseNodeData>) => ({
  id: 'node-src',
  position: { x: 0, y: 0 },
  data: {
    type: 'ai-image',
    label: '源图',
    role: 'source',
    status: 'success',
    ...data,
  } as BaseNodeData,
});

const resolved = { label: '摄影机视角', icon: 'mdi:camera-control', filledPrompt: '低角度镜头', shouldTrigger: true };

describe('createPresetNode 派生 ComfyUI 工作流节点', () => {
  it('provider=comfyui 时继承 workflowId，但不继承 workflowInputs', () => {
    const { node } = createPresetNode(
      source({
        model: 'comfyui/workflow',
        provider: 'comfyui',
        workflowId: 'wf-flux-img2img',
        workflowInputs: { '14': '旧的 IO 赋值' },
      }),
      resolved,
    );

    expect(node.data.workflowId).toBe('wf-flux-img2img');
    expect(node.data.workflowInputs).toBeUndefined();
  });

  it('非 comfyui 模型不带上 workflowId', () => {
    const { node } = createPresetNode(
      source({ model: 'z-image', provider: 'apimart', workflowId: 'wf-flux-img2img' }),
      resolved,
    );

    expect(node.data.workflowId).toBeUndefined();
  });

  it('prompt 前置 @ 引用源节点，参考图才能进工作流', () => {
    const { node } = createPresetNode(source({ model: 'comfyui/workflow', provider: 'comfyui', workflowId: 'wf-1' }), resolved);
    expect(node.data.prompt).toBe('@{node-src:源图}\n低角度镜头');
  });
});

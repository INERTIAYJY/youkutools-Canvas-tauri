import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  corsSafeFetch: vi.fn(),
  storeState: {
    config: { comfyUIUrl: 'http://comfy.test:8188' },
    currentProjectId: 'p1',
    workflows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('../../src/services/ai/httpTransport', () => ({
  corsSafeFetch: mocks.corsSafeFetch,
}));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: { getState: () => mocks.storeState },
}));
vi.mock('../../src/services/pollManager', () => ({
  savePendingTask: vi.fn(),
  updatePendingTask: vi.fn(),
  removePendingTask: vi.fn(),
  registerNodePolling: vi.fn(() => undefined),
  cleanupNodePolling: vi.fn(),
}));
vi.mock('../../src/services/nodeReferenceService', () => ({
  resolveNodeReferences: (value: string) => value,
}));

import { executeComfyUIGenerate } from '../../src/services/comfyWorkflowService';

/** 文生图工作流：两个 CLIPTextEncode（正/负）+ 一个 LoadImage */
const WORKFLOW_JSON = JSON.stringify({
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '正向占位' }, _meta: { title: 'CLIP文本编码' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '负向占位' }, _meta: { title: 'CLIP负面提示词' } },
  '10': { class_type: 'LoadImage', inputs: { image: 'example.png', upload: 'image' }, _meta: { title: '载入图像' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
});

const IO_NODES = [
  { nodeId: '6', title: 'CLIP文本编码', type: 'prompt' },
  { nodeId: '7', title: 'CLIP负面提示词', type: 'prompt' },
  { nodeId: '10', title: '载入图像', type: 'image' },
];

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function registerWorkflow(defaultNodes?: Record<string, string>) {
  mocks.storeState.workflows = [{
    id: 'wf-1',
    name: 'z-image',
    category: 'ai-image',
    fileName: 'z-image.json',
    fileContent: WORKFLOW_JSON,
    ioNodes: IO_NODES,
    defaultNodes,
    createdAt: 1,
  }];
}

function submittedWorkflow(): Record<string, { inputs: Record<string, unknown> }> {
  const call = mocks.corsSafeFetch.mock.calls.find(([url]) => String(url).endsWith('/prompt'));
  return JSON.parse(String((call?.[1] as RequestInit).body)).prompt;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.corsSafeFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/upload/image')) return jsonResponse({ name: 'upload_1.png', subfolder: '', type: 'input' });
    if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'prompt-1' });
    if (url.includes('/history/')) {
      return jsonResponse({
        'prompt-1': {
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
        },
      });
    }
    throw new Error(`未预期的请求：${url}`);
  });
});

const baseParams = { prompt: '一只在屋顶的猫', model: 'wf', provider: 'comfyui', workflowId: 'wf-1' };

describe('ComfyUI 默认 IO 节点', () => {
  it('没 @ 文本节点时，提示词只写进默认的那个 CLIP 节点', async () => {
    registerWorkflow({ prompt: '6' });

    await executeComfyUIGenerate(baseParams);

    const submitted = submittedWorkflow();
    expect(submitted['6'].inputs.text).toBe('一只在屋顶的猫');
    // 负向提示词节点不是默认节点，保持原值
    expect(submitted['7'].inputs.text).toBe('负向占位');
  });

  it('没 @ 图片节点时，提示词框里的图片上传后写进默认 LoadImage 节点', async () => {
    registerWorkflow({ prompt: '6', image: '10' });

    await executeComfyUIGenerate(baseParams, undefined, ['data:image/png;base64,QUJD']);

    expect(submittedWorkflow()['10'].inputs.image).toBe('upload_1.png');
  });

  it('用户 @ 了同类型节点时，默认节点不再介入', async () => {
    registerWorkflow({ prompt: '6' });

    await executeComfyUIGenerate({ ...baseParams, workflowInputs: { '7': '手写的负面词' } });

    const submitted = submittedWorkflow();
    expect(submitted['7'].inputs.text).toBe('手写的负面词');
    expect(submitted['6'].inputs.text).toBe('正向占位');
  });

  it('没配默认节点时保持原有的占位符兜底行为', async () => {
    registerWorkflow();

    await executeComfyUIGenerate(baseParams, undefined, ['data:image/png;base64,QUJD']);

    const submitted = submittedWorkflow();
    // 旧逻辑按“短占位符”猜测，正负两个文本节点都会被写成同一句
    expect(submitted['6'].inputs.text).toBe('一只在屋顶的猫');
    expect(submitted['7'].inputs.text).toBe('一只在屋顶的猫');
    // 没指定默认图片节点就不注入图片
    expect(submitted['10'].inputs.image).toBe('example.png');
  });
});

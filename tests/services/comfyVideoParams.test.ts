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

import { executeComfyUIVideoGenerate } from '../../src/services/comfyWorkflowService';

/** 提示词节点 + Wan 风格 latent 节点（width/height/length）+ 合成节点（frame_rate） */
function registerWorkflow() {
  mocks.storeState.workflows = [{
    id: 'wf-1',
    name: '本地出片',
    category: 'ai-video',
    fileName: 'wan.json',
    fileContent: JSON.stringify({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 't-1' }, _meta: { title: '正向提示词' } },
      // 默认值刻意和用例里选的参数都不一样，漏注入就会被断言抓到
      '2': { class_type: 'WanImageToVideo', inputs: { width: 1280, height: 720, length: 33 } },
      '3': { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 30 } },
    }),
    ioNodes: [{ nodeId: '1', title: '正向提示词', type: 'prompt' }],
    createdAt: 1,
  }];
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function submittedWorkflow(): Record<string, { inputs: Record<string, unknown> }> {
  const call = mocks.corsSafeFetch.mock.calls.find(([url]) => String(url).endsWith('/prompt'));
  return JSON.parse(String((call?.[1] as RequestInit).body)).prompt;
}

beforeEach(() => {
  vi.clearAllMocks();
  registerWorkflow();
  mocks.corsSafeFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'prompt-1' });
    if (url.includes('/history/')) {
      return jsonResponse({
        'prompt-1': {
          status: { completed: true },
          outputs: { '3': { gifs: [{ filename: 'out.mp4', subfolder: '', type: 'output' }] } },
        },
      });
    }
    throw new Error(`未预期的请求：${url}`);
  });
});

describe('ComfyUI 视频参数注入', () => {
  it('@ 了提示词节点也照样把分辨率、帧率、帧数写进工作流', async () => {
    await executeComfyUIVideoGenerate({
      prompt: '海边日落',
      model: 'wf',
      provider: 'comfyui',
      workflowId: 'wf-1',
      // 用户 @ 了提示词 IO 节点：以前会导致参数节点被整个跳过
      workflowInputs: { '1': '海边日落' },
      videoResolution: 480,
      seedanceRatio: '16:9',
      videoFps: 16,
      videoFrames: 81,
    });

    const submitted = submittedWorkflow();
    expect(submitted['1'].inputs.text).toBe('海边日落');
    // 480 是长边，短边按 16:9 换算并对齐到 8
    expect(submitted['2'].inputs).toMatchObject({ width: 480, height: 272, length: 81 });
    expect(submitted['3'].inputs.frame_rate).toBe(16);
  });

  it('自定义长边按比例换算后注入', async () => {
    await executeComfyUIVideoGenerate({
      prompt: '竖屏',
      model: 'wf',
      provider: 'comfyui',
      workflowId: 'wf-1',
      videoResolution: 384,
      seedanceRatio: '9:16',
      videoFps: 24,
      videoFrames: 121,
    });

    expect(submittedWorkflow()['2'].inputs).toMatchObject({ width: 216, height: 384, length: 121 });
  });
});

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
  generateId: () => 'id-1',
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

import { pendingBuiltInWorkflows, resetBuiltInWorkflows, withBuiltInEditableContent } from '../../src/services/builtinWorkflows';
import { executeComfyUIAudioGenerate, executeComfyUIVideoGenerate } from '../../src/services/comfyWorkflowService';
import { extractComfyUIIONodes } from '../../src/services/comfyUIWindowService';
import { resolveVideoSubmissionControls } from '../../src/services/ai/videoRequestResolver';
import type { WorkflowDefinition } from '../../src/types';

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function submittedWorkflow(): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const call = mocks.corsSafeFetch.mock.calls.find(([url]) => String(url).endsWith('/prompt'));
  return JSON.parse(String((call?.[1] as RequestInit).body)).prompt;
}

/** 把内置工作流装进 store，然后按 id 提交一次 */
async function runBuiltIn(
  workflowId: string,
  params: Parameters<typeof executeComfyUIVideoGenerate>[0],
  promptMedia: { imageUrls?: string[]; videoUrls?: string[] } = {},
) {
  const workflows = pendingBuiltInWorkflows([]);
  mocks.storeState.workflows = workflows as unknown as Array<Record<string, unknown>>;
  await executeComfyUIVideoGenerate({ ...params, workflowId }, undefined, [], promptMedia);
  return workflows.find((workflow) => workflow.id === workflowId) as WorkflowDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.corsSafeFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/upload/image')) {
      return jsonResponse({ name: 'upload_1.png', subfolder: '', type: 'input' });
    }
    if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'prompt-1' });
    if (url.includes('/history/')) {
      return jsonResponse({
        'prompt-1': {
          status: { completed: true },
          outputs: { '92': { images: [{ filename: 'out.mp4', subfolder: '', type: 'output' }] } },
        },
      });
    }
    throw new Error(`未预期的请求：${url}`);
  });
});

describe('内置 MiniMax H3 工作流', () => {
  it('首次启动播种六个视频与两个音频工作流，之后不再重复添加', () => {
    const first = pendingBuiltInWorkflows([]);
    expect(first).toHaveLength(8);
    expect(first.filter((workflow) => workflow.category === 'ai-video')).toHaveLength(6);
    expect(first.filter((workflow) => workflow.category === 'ai-audio')).toHaveLength(2);
    expect(pendingBuiltInWorkflows([])).toHaveLength(0);
  });

  it('只记账已经建出来的，剩下的下次启动继续补', () => {
    localStorage.setItem(
      'aicanvas.builtinWorkflows.seededIds',
      JSON.stringify(['builtin-minimax-h3-t2v']),
    );
    const pending = pendingBuiltInWorkflows([]);
    expect(pending.map((workflow) => workflow.id)).not.toContain('builtin-minimax-h3-t2v');
    expect(pending).toHaveLength(7);
  });

  it('默认 IO 节点都能在工作流 JSON 里找到对应的输入', () => {
    for (const workflow of pendingBuiltInWorkflows([])) {
      const json = JSON.parse(workflow.fileContent) as Record<string, { inputs: Record<string, unknown> }>;
      for (const [type, nodeId] of Object.entries(workflow.defaultNodes ?? {})) {
        expect(json[nodeId], `${workflow.name} 的 ${type} 默认节点`).toBeTruthy();
        expect(workflow.ioNodes?.some((io) => io.nodeId === nodeId && io.type === type)).toBe(true);
      }
    }
  });

  it('文生视频：分辨率写进 ResolutionSelector，时长写进秒数节点，帧率保持工作流原值', async () => {
    await runBuiltIn('builtin-minimax-h3-t2v', {
      prompt: '海边日落',
      model: 'wf',
      provider: 'comfyui',
      videoResolution: 480,
      seedanceRatio: '16:9',
      seedanceDuration: 6,
      videoFps: 24,
    });

    const submitted = submittedWorkflow();
    expect(submitted['105:104'].inputs.prompt).toBe('海边日落');
    // 480×272 ≈ 0.13MP，比例写成 combo 里合法的档位
    expect(submitted['115'].inputs).toMatchObject({
      aspect_ratio: '16:9 (Widescreen)',
      megapixels: 0.13,
    });
    expect(submitted['105:111'].inputs.value).toBe(6);
    // 秒→帧由工作流自己的算式按 24 帧完成，改帧率反而会让时长错位
    expect(submitted['105:91'].inputs.fps).toBe(24);
  });

  it.each([
    { name: '未设置时长使用 5 秒', controls: {}, seconds: 5 },
    { name: '明确选择 3 秒', controls: { seedanceDuration: 3 }, seconds: 3 },
    { name: '旧节点的 77 帧换算为 3 秒', controls: { videoFrames: 77, videoFps: 24 }, seconds: 3 },
    { name: '选择 3 秒覆盖旧的 121 帧', controls: { seedanceDuration: 3, videoFrames: 121 }, seconds: 3 },
  ])('图生视频时长提交：$name', async ({ controls, seconds }) => {
    const workflowId = 'builtin-minimax-h3-i2v';
    await runBuiltIn(workflowId, {
      // 提示词里的秒数不能覆盖参数控件。
      prompt: 'Create a 5-second shot', model: 'wf', provider: 'comfyui',
      ...resolveVideoSubmissionControls({ provider: 'comfyui', workflowId, ...controls }),
    });

    const submitted = submittedWorkflow();
    expect(submitted['105:111'].inputs.value).toBe(seconds);
    expect(submitted['105:107'].inputs['values.a']).toEqual(['105:111', 0]);
    expect(submitted['105:91'].inputs.fps).toBe(24);
    // 注入只改变提交副本，不覆盖用户保存的工作流默认值。
    const stored = JSON.parse(String(mocks.storeState.workflows.find((workflow) => workflow.id === workflowId)?.fileContent));
    expect(stored['105:111'].inputs.value).toBe(5);
  });

  it('图生视频：连线图片上传后写进 LoadImage', async () => {
    await runBuiltIn(
      'builtin-minimax-h3-i2v',
      { prompt: '让它动起来', model: 'wf', provider: 'comfyui', seedanceRatio: '9:16' },
      { imageUrls: ['data:image/png;base64,QUJD'] },
    );

    const submitted = submittedWorkflow();
    expect(submitted['114'].inputs.image).toBe('upload_1.png');
    expect(submitted['115'].inputs.aspect_ratio).toBe('9:16 (Portrait Widescreen)');
  });

  it('参考生视频：只给一张图时，多余的参考位连同视频链路一起摘掉', async () => {
    await runBuiltIn(
      'builtin-minimax-h3-r2v-turbo',
      { prompt: '按参考图生成', model: 'wf', provider: 'comfyui' },
      { imageUrls: ['data:image/png;base64,QUJD'] },
    );

    const submitted = submittedWorkflow();
    expect(submitted['169'].inputs.image).toBe('upload_1.png');
    // 第二张参考图、参考视频和取元素节点都不该留在提交里
    expect(submitted['170']).toBeUndefined();
    expect(submitted['167']).toBeUndefined();
    expect(submitted['168']).toBeUndefined();
    expect(Object.keys(submitted['136'].inputs).filter((key) => key.startsWith('ref_')))
      .toEqual(['ref_image_size', 'ref_images.ref_image_0']);
  });

  it('参考生视频：两张图各就各位，不会互相覆盖', async () => {
    await runBuiltIn(
      'builtin-minimax-h3-r2v',
      { prompt: '双角色同框', model: 'wf', provider: 'comfyui' },
      // 上传结果按内容缓存，这里要用别的用例没传过的图，否则命中缓存就不会真的上传
      { imageUrls: ['data:image/png;base64,SEhI', 'data:image/png;base64,SUlJ'] },
    );

    const submitted = submittedWorkflow();
    expect(submitted['137'].inputs.image).toBe('upload_1.png');
    expect(submitted['139'].inputs.image).toBe('upload_1.png');
    const uploads = mocks.corsSafeFetch.mock.calls.filter(([url]) => String(url).endsWith('/upload/image'));
    expect(uploads).toHaveLength(2);
  });
});

describe('内置 AuK 音频工作流', () => {
  beforeEach(() => {
    let outputFormat = 'flac';
    mocks.corsSafeFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/upload/image')) return jsonResponse({ name: 'auk-reference.wav', subfolder: '', type: 'input' });
      if (url.endsWith('/prompt')) {
        const body = JSON.parse(String(init?.body));
        outputFormat = body.prompt['6'].inputs.format;
        return jsonResponse({ prompt_id: 'prompt-auk' });
      }
      if (url.includes('/history/')) {
        return jsonResponse({
          'prompt-auk': { status: { completed: true }, outputs: {
            '6': { audio: [{ filename: `auk.${outputFormat}`, subfolder: 'audio', type: 'output' }] },
          } },
        });
      }
      throw new Error(`未预期的请求：${url}`);
    });
  });

  function installAuK(id: string) {
    const workflows = pendingBuiltInWorkflows([]);
    mocks.storeState.workflows = workflows as unknown as Array<Record<string, unknown>>;
    return workflows.find((workflow) => workflow.id === id)!;
  }

  it('已有六个视频工作流的用户只补两个音频工作流，不复写旧数据', () => {
    const initial = resetBuiltInWorkflows();
    const existing = initial.filter((workflow) => workflow.category === 'ai-video');
    existing[0].name = '用户修改的名字';
    localStorage.setItem('aicanvas.builtinWorkflows.seededIds', JSON.stringify(existing.map((workflow) => workflow.id)));
    const pending = pendingBuiltInWorkflows(existing);
    expect(pending.map((workflow) => workflow.id)).toEqual(['builtin-auk-tts', 'builtin-auk-voice-cloning']);
    expect(existing[0].name).toBe('用户修改的名字');
    expect(pendingBuiltInWorkflows(existing)).toEqual([]);
    expect(resetBuiltInWorkflows()).toHaveLength(8);
  });

  it.each(['builtin-auk-tts', 'builtin-auk-voice-cloning'])('%s 保留可编辑布局、模型、采样参数和全部执行连线', (id) => {
    const workflow = installAuK(id);
    const api = JSON.parse(workflow.fileContent);
    const ui = JSON.parse(workflow.editableContent!);
    const executableNodes = ui.nodes.filter((node: { type: string }) => node.type !== 'MarkdownNote');
    expect(Object.keys(api)).toHaveLength(executableNodes.length);
    for (const node of executableNodes) {
      expect(api[String(node.id)].class_type).toBe(node.type);
      expect(node.pos).toHaveLength(2);
    }
    for (const [, sourceId, outputIndex, targetId, inputIndex] of ui.links) {
      const target = ui.nodes.find((node: { id: number }) => node.id === targetId);
      expect(api[String(targetId)].inputs[target.inputs[inputIndex].name]).toEqual([String(sourceId), outputIndex]);
    }
    expect(api['1'].inputs.model_name).toBe('auk_flash_w4a8.safetensors');
    expect(api['2'].inputs.encoder_name).toBe('qwen_omni_w4a8.safetensors');
    expect(api['3'].inputs.vae_name).toBe('auk_vae.safetensors');
    expect(api['5'].inputs).toMatchObject({ seconds: 3, seed: 42, steps: 32, guidance: 2, sway: -1 });
    expect(withBuiltInEditableContent(workflow)).toBeNull();
    expect(withBuiltInEditableContent({ ...workflow, editableContent: undefined })?.editableContent).toBe(workflow.editableContent);
  });

  it('文生语音将正文与声音描述组合后取回 FLAC，保持保存参数', async () => {
    const workflow = installAuK('builtin-auk-tts');
    const prompt = '欢迎回来。';
    const result = await executeComfyUIAudioGenerate({ prompt, model: 'wf', provider: 'comfyui', workflowId: workflow.id });
    const submitted = submittedWorkflow();
    expect(workflow.ioNodes).toEqual([{ nodeId: '4', title: 'AuKInstructionEncode', type: 'prompt' }]);
    expect(submitted['4'].inputs.instruction).toContain(`The content to speak is: ${JSON.stringify(prompt)}.`);
    expect(submitted['4'].inputs.instruction).toContain('adult female voice');
    expect(submitted['4'].inputs.audio).toBeUndefined();
    expect(submitted['6'].inputs).toEqual({ audio: ['5', 0], filename_prefix: 'audio/AuK', format: 'flac' });
    expect(result.url).toContain('auk.flac');
    expect(mocks.corsSafeFetch.mock.calls.some(([url]) => String(url).endsWith('/upload/image'))).toBe(false);
    expect(JSON.parse(workflow.fileContent)['4'].inputs.instruction).toContain('Hello, welcome to AuK.');
  });

  it('克隆台词写入动态字段，参考音频上传后接入原图，取回 MP3', async () => {
    const workflow = installAuK('builtin-auk-voice-cloning');
    const result = await executeComfyUIAudioGenerate(
      { prompt: '你好，欢迎回来。', model: 'wf', provider: 'comfyui', workflowId: workflow.id },
      undefined, ['data:audio/wav;base64,QVVLLUNMT05F'],
    );
    const submitted = submittedWorkflow();
    expect(workflow.ioNodes?.map(({ nodeId, type }) => ({ nodeId, type }))).toEqual([
      { nodeId: '7', type: 'audio' }, { nodeId: '10', type: 'prompt' },
    ]);
    expect(submitted['10'].inputs).toEqual({ task: 'Voice cloning', 'task.text': '你好，欢迎回来。' });
    expect(submitted['4'].inputs.instruction).toEqual(['10', 0]);
    expect(submitted['4'].inputs.audio).toEqual(['7', 0]);
    expect(submitted['7'].inputs.audio).toBe('auk-reference.wav');
    expect(submitted['6'].inputs).toEqual({ audio: ['5', 0], filename_prefix: 'audio/AuK', format: 'mp3', 'format.quality': 'V0' });
    expect(result.url).toContain('auk.mp3');
    expect(JSON.parse(workflow.fileContent)['7'].inputs.audio).toBe('sample-2.mp3');
  });

  it.each([
    ['builtin-auk-tts', '4', 'instruction'],
    ['builtin-auk-voice-cloning', '10', 'task.text'],
  ])('%s 显式 @ 提示词优先于默认正文', async (id, nodeId, field) => {
    const workflow = installAuK(id);
    await executeComfyUIAudioGenerate({
      prompt: '默认正文', model: 'wf', provider: 'comfyui', workflowId: workflow.id,
      workflowInputs: { [nodeId]: '显式台词', ...(id.endsWith('voice-cloning') ? { '7': 'data:audio/wav;base64,YXVkaW8=' } : {}) },
    });
    expect(submittedWorkflow()[nodeId].inputs[field]).toContain('显式台词');
    expect(submittedWorkflow()[nodeId].inputs[field]).not.toContain('默认正文');
  });

  it('显式 @ 音频优先于连线音频', async () => {
    const workflow = installAuK('builtin-auk-voice-cloning');
    const explicit = 'data:audio/wav;base64,QVVLLUVERkFVRFJP';
    await executeComfyUIAudioGenerate({
      prompt: '台词', model: 'wf', provider: 'comfyui', workflowId: workflow.id,
      workflowInputs: { '7': explicit },
    }, undefined, ['data:audio/wav;base64,QVVLLU9USEVS']);
    const uploads = mocks.corsSafeFetch.mock.calls.filter(([url]) => String(url).endsWith('/upload/image'));
    expect(uploads).toHaveLength(1);
    const body = uploads[0][1].body as FormData;
    expect(await (body.get('image') as Blob).text()).toBe(atob(explicit.split(',')[1]));
    expect(submittedWorkflow()['7'].inputs.audio).toBe('auk-reference.wav');
  });

  it('指令连线和展示节点不会被当成新的提示词入口', () => {
    expect(extractComfyUIIONodes(JSON.stringify({
      a: { class_type: 'AuKInstructionEncode', inputs: { instruction: ['b', 0] } },
      b: { class_type: 'AuKInstructionBuilder', inputs: { task: 'Voice cloning', 'task.text': '台词' } },
      c: { class_type: 'PreviewAny', inputs: { instruction: '展示结果' } },
    }))).toEqual([{ nodeId: 'b', title: 'AuKInstructionBuilder', type: 'prompt' }]);
  });
  it('纯文本参数只改本次请求，速度指令与朗读正文分离', async () => {
    const workflow = installAuK('builtin-auk-tts');
    const original = workflow.fileContent;
    await executeComfyUIAudioGenerate({
      prompt: '你好。', model: 'wf', provider: 'comfyui', workflowId: workflow.id,
      audioSpeechSettings: { voiceStyle: 'boy', pace: 1, duration: 12 },
    });
    const graph = submittedWorkflow();
    expect(graph['4'].inputs.instruction).toContain('natural young boy voice');
    expect(graph['4'].inputs.instruction).toContain('slightly slower pace');
    expect(graph['4'].inputs.instruction).toContain('The content to speak is: "你好。".');
    expect(graph['5'].inputs).toMatchObject({ seconds: 12, seed: 42, steps: 32, guidance: 2, sway: -1 });
    expect(workflow.fileContent).toBe(original);
  });

  it('克隆保留音频连线，忽略纯文本音色并把速度写入指令', async () => {
    const workflow = installAuK('builtin-auk-voice-cloning');
    const original = workflow.fileContent;
    await executeComfyUIAudioGenerate({
      prompt: '欢迎。', model: 'wf', provider: 'comfyui', workflowId: workflow.id,
      audioSpeechSettings: { voiceStyle: 'male', pace: 3, duration: 8 },
    }, undefined, ['data:audio/wav;base64,YXVkaW8=']);
    const graph = submittedWorkflow();
    expect(graph['4'].inputs.audio).toEqual(['7', 0]);
    expect(graph['4'].inputs.instruction).toBe('Say the following with the same voice: "欢迎。". Speak at a slightly faster pace.');
    expect(graph['5'].inputs.seconds).toBe(8);
    expect(workflow.fileContent).toBe(original);
  });

  it('缺少参考时在上传和提交前拒绝，不使用示例文件', async () => {
    const workflow = installAuK('builtin-auk-voice-cloning');
    await expect(executeComfyUIAudioGenerate({ prompt: '台词', model: 'wf', provider: 'comfyui', workflowId: workflow.id })).rejects.toThrow('请添加参考语音');
    expect(mocks.corsSafeFetch).not.toHaveBeenCalled();
  });

  it('纯文本工作流收到参考语音时提示切换，不忽略引用', async () => {
    const workflow = installAuK('builtin-auk-tts');
    await expect(executeComfyUIAudioGenerate({ prompt: '台词', model: 'wf', provider: 'comfyui', workflowId: workflow.id }, undefined, ['data:audio/wav;base64,YQ=='])).rejects.toThrow('不接收参考语音');
    expect(mocks.corsSafeFetch).not.toHaveBeenCalled();
  });

});

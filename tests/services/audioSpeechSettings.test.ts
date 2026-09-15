import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BaseNodeData, WorkflowDefinition } from '../../src/types';
import type { AudioSpeechSettings } from '../../src/types/aiTypes';
import { emptyDramaAssetLibrary } from '../../src/types/dramaAssets';
import {
  AUDIO_SPEECH_VOICES, applyAudioSpeechSettings, collectAudioSpeechReferences,
  normalizeAudioSpeechSettings, removeAudioSpeechReference, resolveAudioSpeechWorkflow, stripAudioSpeechReferences,
} from '../../src/services/ai/audioSpeechSettings';
import { useAppStore } from '../../src/store/useAppStore';
import { generateAudio } from '../../src/services/ai/generateAudio';
import { mediaProviderRegistry } from '../../src/services/ai/mediaProviderRegistry';
import AudioParamSelector from '../../src/components/nodes/shared/AudioParamSelector';
import { batchExecuteNodes } from '../../src/utils/batchExecute';
import { executeGeneration } from '../../src/services/generationService';

// 展开参数弹层进行服务端结构检查；不模拟浏览器布局或真实合成。
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: () => [true, vi.fn()],
}));

function workflow(reference = false): WorkflowDefinition {
  const graph = {
    encode: { class_type: 'AuKInstructionEncode', inputs: {
      instruction: reference ? ['builder', 0] : '原始指令', ...(reference ? { audio: ['audio', 0] } : {}),
    } },
    generate: { class_type: 'AuKGenerateEdit', inputs: { conditioning: ['encode', 0], seconds: 3 } },
    ...(reference ? {
      builder: { class_type: 'AuKInstructionBuilder', inputs: { task: 'Voice cloning', 'task.text': '台词' } },
      audio: { class_type: 'LoadAudio', inputs: { audio: 'example.mp3' } },
    } : {}),
  };
  return { id: 'custom-speech', name: '复制的语音图', category: 'ai-audio', createdAt: 0, fileName: 'speech.json', fileContent: JSON.stringify(graph),
    ioNodes: [{ nodeId: reference ? 'builder' : 'encode', type: 'prompt', title: '正文' },
      ...(reference ? [{ nodeId: 'audio', type: 'audio' as const, title: '参考语音' }] : [])] };
}

const nodes = [
  { id: 'target', data: { type: 'ai-audio', label: '生成节点', audioUrl: 'own.wav' } as BaseNodeData },
  { id: 'source', data: { type: 'source-audio', label: '原声', audioUrl: 'voice.wav', output: 'voice.wav' } as BaseNodeData },
  { id: 'text', data: { type: 'ai-text', label: '台词', output: '你好。' } as BaseNodeData },
];
const edge = { id: 'connection', source: 'source', target: 'target' };
function library() {
  const value = emptyDramaAssetLibrary();
  value.characters.push({ id: 'char', key: 'char', name: '角色', kind: 'character', createdAt: 0, updatedAt: 0,
    identity: '', summary: '', visualNotes: '', importance: 'main', confirmed: true, source: 'manual',
    voiceClips: [{ id: 'clip', kind: 'timbre', label: '声音', audioUrl: 'snapshot.wav', transcript: '', createdAt: 0, updatedAt: 0 }] });
  return value;
}

describe('音频参数与引用状态', () => {
  it('按节点结构识别工作流，拒绝损坏、音乐、云端或多路生成图', () => {
    expect(resolveAudioSpeechWorkflow(workflow())).toMatchObject({ encodeId: 'encode', textNodeId: 'encode', duration: 3 });
    expect(resolveAudioSpeechWorkflow(workflow(true))).toMatchObject({ textNodeId: 'builder', referenceInputId: 'audio' });
    expect(resolveAudioSpeechWorkflow({ ...workflow(), fileContent: 'null' })).toBeUndefined();
    expect(resolveAudioSpeechWorkflow({ ...workflow(), adapterType: 'runninghub' })).toBeUndefined();
    const original = JSON.parse(workflow().fileContent);
    original.other = original.generate;
    expect(resolveAudioSpeechWorkflow({ ...workflow(), fileContent: JSON.stringify(original) })).toBeUndefined();
    expect(resolveAudioSpeechWorkflow({ ...workflow(), ioNodes: [] })).toBeUndefined();
  });

  it('生成结果本身不算参考；@ 音频、角色声音、连线分别可移除', () => {
    const collect = (prompt = '', edges: typeof edge[] = []) => collectAudioSpeechReferences(prompt, 'target', nodes, edges, library());
    expect(collect()).toEqual([]);
    expect(collect('@{source:原声}')[0]).toMatchObject({ url: 'voice.wav', token: '@{source:原声}' });
    expect(collect('@drama{char#voice/clip:角色}')[0]).toMatchObject({ url: 'snapshot.wav' });
    expect(collect('', [edge])[0]).toMatchObject({ url: 'voice.wav', edgeId: 'connection' });
    expect(collect('@{text:台词}')).toEqual([]);
    const prompt = '你好 @{source:原声}';
    const next = removeAudioSpeechReference(prompt, undefined, collect(prompt)[0]);
    expect(next.prompt).toBe('你好');
    expect(collect(next.prompt)).toEqual([]);
  });

  it('显式工作流音频只显示一次，并连同标记和赋值一并移除', () => {
    const prompt = '你好 @wf{audio|参考|audio}(@drama{char#voice/clip:角色})';
    const inputs = { audio: '@drama{char#voice/clip:角色}', builder: '别的台词' };
    const references = collectAudioSpeechReferences(prompt, 'target', nodes, [], library(), workflow(true), inputs);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ inputId: 'audio', url: 'snapshot.wav' });
    expect(removeAudioSpeechReference(prompt, inputs, references[0])).toEqual({ prompt: '你好', workflowInputs: { builder: '别的台词' } });
    expect(inputs.audio).toContain('@drama');
  });

  it('失效引用保留可见标记，不被误当成纯文本', () => {
    const references = collectAudioSpeechReferences('@drama{char#voice/gone:旧声音}', 'target', nodes, [], library());
    expect(references).toHaveLength(1);
    expect(references[0].url).toBeUndefined();
  });

  it('只剥离音频引用和工作流标记，保留文本引用与原有断行', () => {
    expect(stripAudioSpeechReferences('第一句\n@{text:台词}\n@{source:原声} @drama{char#voice/clip:角色}', nodes)).toBe('第一句\n@{text:台词}');
    expect(stripAudioSpeechReferences('@wf{audio|参考|audio}(file.wav)你好', nodes)).toBe('你好');
  });

  it('对非法持久化参数回退或限幅，切换模式不改原设置', () => {
    expect(normalizeAudioSpeechSettings({ pace: NaN, duration: Infinity })).toEqual({ voiceStyle: 'female', pace: 2, duration: 3 });
    expect(normalizeAudioSpeechSettings({ pace: 99, duration: -2 })).toMatchObject({ pace: 4, duration: 1 });
    const settings: AudioSpeechSettings = { voiceStyle: 'loli', pace: 4, duration: 15 };
    const clone = workflow(true);
    applyAudioSpeechSettings(JSON.parse(clone.fileContent), resolveAudioSpeechWorkflow(clone)!, settings);
    expect(JSON.parse(JSON.stringify(settings))).toEqual({ voiceStyle: 'loli', pace: 4, duration: 15 });
  });

  it.each(AUDIO_SPEECH_VOICES)('$label 对应独立描述，不作为厂商 voice ID 传递', ({ value, description }) => {
    const wf = workflow();
    const graph = JSON.parse(wf.fileContent);
    graph.encode.inputs.instruction = '你好。';
    applyAudioSpeechSettings(graph, resolveAudioSpeechWorkflow(wf)!, { voiceStyle: value });
    expect(graph.encode.inputs.instruction).toContain(description);
    expect(graph.encode.inputs.instruction).toContain('The content to speak is: "你好。".');
  });

  it('空正文不会朗读默认示例', () => {
    const wf = workflow();
    const graph = JSON.parse(wf.fileContent);
    graph.encode.inputs.instruction = '  ';
    expect(() => applyAudioSpeechSettings(graph, resolveAudioSpeechWorkflow(wf)!)).toThrow('请输入需要朗读的文本');
  });
});

describe('参数面板状态', () => {
  it.each(['dark', 'light'])('%s 主题使用公用控件，参考状态隐藏声音按钮，移除后恢复选择', (theme) => {
    const props = { purpose: 'speech' as const, speechControls: resolveAudioSpeechWorkflow(workflow())!, speechSettings: { voiceStyle: 'boy' as const }, onChangeSpeechSettings: vi.fn() };
    const render = (references: ReturnType<typeof collectAudioSpeechReferences>) => renderToStaticMarkup(createElement('div', { 'data-theme': theme }, createElement(AudioParamSelector, { ...props, references })));
    const pure = render([]);
    expect(pure).toContain('data-audio-speech-mode="text"');
    expect(pure).toContain('声音类型');
    expect(pure).toContain('生成时长（秒）');
    const reference = render([{ key: 'ref', label: '角色声音', url: 'voice.wav' }]);
    expect(reference).toContain('data-audio-speech-mode="reference"');
    expect(reference).not.toContain('声音类型');
    expect(reference).toContain('移除参考 角色声音');
    expect(render([])).toBe(pure);
  });
});

describe('生成入口的文本与参考分离', () => {
  beforeEach(() => {
    useAppStore.setState({ nodes: nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })), edges: [edge], dramaAssets: library(), history: [], historyIndex: -1 });
  });

  it('展开文本节点，同时把 @音频、角色快照和连线放入媒体通道', async () => {
    const adapter = { providerId: 'test', capabilities: ['audio'] as const, generateAudio: vi.fn().mockResolvedValue({ url: 'result.wav' }) };
    vi.spyOn(mediaProviderRegistry, 'getAudioAdapter').mockReturnValue(adapter);
    await generateAudio({ prompt: '@{text:台词} @{source:原声} @drama{char#voice/clip:角色}', model: 'test', provider: 'test', nodeId: 'target', audioVoice: 'alloy', audioSpeed: 1.25 });
    expect(adapter.generateAudio).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '你好。', referenceAudioUrls: ['voice.wav', 'snapshot.wav'],
      params: expect.objectContaining({ audioVoice: 'alloy', audioSpeed: 1.25 }),
    }));
  });

  it.each(['batch', 'shortcut'])('%s 入口保留语音参数及输出历史，调用相同生成链路', async (entry) => {
    const settings = { voiceStyle: 'shota' as const, pace: 1, duration: 12 };
    const adapter = { providerId: 'test', capabilities: ['audio'] as const, generateAudio: vi.fn().mockResolvedValue({ url: 'result.wav' }) };
    vi.spyOn(mediaProviderRegistry, 'getAudioAdapter').mockReturnValue(adapter);
    const history = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ currentProjectId: null, recordOutputHistory: history });
    useAppStore.getState().updateNodeData('target', { model: 'test', provider: 'test', prompt: '台词', audioSpeechSettings: settings });
    const state = useAppStore.getState();
    if (entry === 'batch') {
      expect(await batchExecuteNodes(['target'], state.nodes, state.edges, {
        commitToHistory: state.commitToHistory, updateNodeDataTransient: state.updateNodeDataTransient,
        recordOutputHistory: history, currentProjectId: null,
      })).toEqual({ ok: 1, fail: 0 });
    } else {
      expect((await executeGeneration('target')).success).toBe(true);
    }
    expect(adapter.generateAudio).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ audioSpeechSettings: settings }) }));
    expect(history).toHaveBeenCalledWith('target', expect.objectContaining({ params: expect.objectContaining({ audioSpeechSettings: settings }) }));
  });

  it('参数通过节点 Action 保存，按现有语义不随画布结构撤销', async () => {
    const state = useAppStore.getState();
    state.updateNodeData('target', { audioSpeechSettings: { voiceStyle: 'boy', pace: 1, duration: 12 } });
    expect(useAppStore.getState().nodes[0].data.audioSpeechSettings).toEqual({ voiceStyle: 'boy', pace: 1, duration: 12 });
    await useAppStore.getState().undo();
    expect(useAppStore.getState().nodes[0].data.audioSpeechSettings).toEqual({ voiceStyle: 'boy', pace: 1, duration: 12 });
  });
});

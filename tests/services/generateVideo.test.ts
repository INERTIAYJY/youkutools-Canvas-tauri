import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotateCharacterReferences,
  buildGeneralVideoProtocolVariables,
  generateVideo,
  resolveVideoGenerationOperation,
} from '../../src/services/ai/generateVideo';
import { resolvePromptWithImageRefs, resolvePromptWithMediaRefs } from '../../src/services/ai/promptResolver';
import {
  collectConnectedReferenceMedia,
  getMediaReferenceUrls,
  mergeMediaReferences,
} from '../../src/services/ai/connectedReferenceMedia';
import { mediaProviderRegistry } from '../../src/services/ai/mediaProviderRegistry';
import { useAppStore } from '../../src/store/useAppStore';
import type { BaseNodeData } from '../../src/types';
import type { VideoGenerationReferenceInput, VideoReferenceItem } from '../../src/types/aiTypes';

const comfyMocks = vi.hoisted(() => ({
  executeVideo: vi.fn(),
}));

vi.mock('../../src/services/comfyWorkflowService', () => ({
  executeComfyUIVideoGenerate: comfyMocks.executeVideo,
}));

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  comfyMocks.executeVideo.mockReset();
  comfyMocks.executeVideo.mockResolvedValue({ url: 'https://cdn.example/result.mp4' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('video prompt media references', () => {
  it('extracts mentioned audio nodes once as reference media', async () => {
    const audioNode: Node<BaseNodeData> = {
      id: 'audio-1',
      type: 'ai-audio',
      position: { x: 0, y: 0 },
      data: {
        label: '角色台词',
        type: 'ai-audio',
        audioUrl: 'https://cdn.example/dialogue.mp3',
      },
    };
    useAppStore.setState({ nodes: [audioNode] });

    const result = await resolvePromptWithMediaRefs(
      '让 @{audio-1:角色台词} 驱动画面，并保持 @{audio-1:角色台词} 的节奏',
    );

    expect(result).toEqual({
      prompt: '让 音频1 驱动画面，并保持 音频1 的节奏',
      references: [{
        kind: 'audio',
        url: 'https://cdn.example/dialogue.mp3',
        origin: 'prompt',
        role: 'reference_audio',
        sourceNodeId: 'audio-1',
        filePath: undefined,
        sourceUrl: undefined,
      }],
      imageUrls: [],
      videoUrls: [],
      audioUrls: ['https://cdn.example/dialogue.mp3'],
    });
  });

  it('keeps the image-generation resolver compatible with inline audio URLs', async () => {
    const audioNode: Node<BaseNodeData> = {
      id: 'audio-1',
      type: 'source-audio',
      position: { x: 0, y: 0 },
      data: {
        label: '参考声音',
        type: 'source-audio',
        audioUrl: 'https://cdn.example/reference.wav',
      },
    };
    useAppStore.setState({ nodes: [audioNode] });

    await expect(resolvePromptWithImageRefs('@{audio-1:参考声音}')).resolves.toEqual({
      prompt: 'https://cdn.example/reference.wav',
      imageUrls: [],
    });
  });

  it('falls back to the persisted local image when a generated source URL has expired', async () => {
    class UnreachableImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', UnreachableImage);

    const imageNode: Node<BaseNodeData> = {
      id: 'generated-image',
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: {
        label: '生成首帧',
        type: 'ai-image',
        imageUrl: 'asset://localhost/generated.png',
        sourceUrl: 'https://expired.example/generated.png',
        filePath: '/project/data/generated.png',
      },
    };
    useAppStore.setState({ nodes: [imageNode] });

    await expect(resolvePromptWithMediaRefs('@{generated-image:生成首帧}')).resolves.toEqual({
      prompt: '图片1',
      references: [{
        kind: 'image',
        url: 'asset://localhost/generated.png',
        origin: 'prompt',
        role: 'reference',
        sourceNodeId: 'generated-image',
        filePath: '/project/data/generated.png',
        sourceUrl: undefined,
      }],
      imageUrls: ['asset://localhost/generated.png'],
      videoUrls: [],
      audioUrls: [],
    });
  });

  it('passes mentioned audio into ComfyUI audio IO and deduplicates a matching edge', async () => {
    const audioNode: Node<BaseNodeData> = {
      id: 'audio-1',
      type: 'ai-audio',
      position: { x: 0, y: 0 },
      data: {
        label: '角色台词',
        type: 'ai-audio',
        audioUrl: 'https://cdn.example/dialogue.mp3',
      },
    };
    useAppStore.setState({
      nodes: [audioNode],
      edges: [{ id: 'audio-to-video', source: 'audio-1', target: 'video-1' }],
    });

    await generateVideo({
      model: 'comfyui/lipsync',
      provider: 'comfyui',
      prompt: '按照 @{audio-1:角色台词} 对口型',
      workflowId: 'lipsync',
      nodeId: 'video-1',
    });

    expect(comfyMocks.executeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '按照 https://cdn.example/dialogue.mp3 对口型',
      }),
      undefined,
      ['https://cdn.example/dialogue.mp3'],
      { imageUrls: [], videoUrls: [] },
    );
  });

  it('converts user-facing seconds to workflow frames before ComfyUI execution', async () => {
    await generateVideo({
      model: 'comfyui/video',
      provider: 'comfyui',
      prompt: '生成视频',
      workflowId: 'video-workflow',
      videoFps: 30,
      seedanceDuration: 8,
      videoFrames: 77,
    });

    expect(comfyMocks.executeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoFps: 30,
        seedanceDuration: 8,
        videoFrames: 241,
      }),
      undefined,
      [],
      { imageUrls: [], videoUrls: [] },
    );
  });

  it('collects all three connected media kinds and keeps local and remote transports distinct', () => {
    const imageNode: Node<BaseNodeData> = {
      id: 'image-1',
      type: 'source-image',
      position: { x: 0, y: 0 },
      data: {
        label: '首帧',
        type: 'source-image',
        imageUrl: 'asset://localhost/first.png',
        sourceUrl: 'https://cdn.example/first.png',
        filePath: 'C:\\project\\first.png',
      },
    };
    const videoNode: Node<BaseNodeData> = {
      id: 'video-ref',
      type: 'source-video',
      position: { x: 0, y: 0 },
      data: {
        label: '动作参考',
        type: 'source-video',
        videoUrl: 'asset://localhost/reference.mp4',
        sourceUrl: 'https://cdn.example/reference.mp4',
        filePath: 'C:\\project\\reference.mp4',
      },
    };
    const audioNode: Node<BaseNodeData> = {
      id: 'audio-ref',
      type: 'source-audio',
      position: { x: 0, y: 0 },
      data: {
        label: '声音参考',
        type: 'source-audio',
        audioUrl: 'asset://localhost/reference.wav',
        sourceUrl: 'https://cdn.example/reference.wav',
        filePath: 'C:\\project\\reference.wav',
      },
    };
    useAppStore.setState({
      nodes: [imageNode, videoNode, audioNode],
      edges: [
        { id: 'image-edge', source: 'image-1', target: 'video-1' },
        { id: 'video-edge', source: 'video-ref', target: 'video-1' },
        { id: 'audio-edge', source: 'audio-ref', target: 'video-1' },
      ],
    });

    const media = collectConnectedReferenceMedia('video-1');

    expect(media.imageUrls).toEqual(['https://cdn.example/first.png']);
    expect(media.videoUrls).toEqual(['https://cdn.example/reference.mp4']);
    expect(media.audioUrls).toEqual(['https://cdn.example/reference.wav']);
    expect(media.references).toMatchObject([
      { kind: 'image', sourceNodeId: 'image-1', origin: 'connection' },
      { kind: 'video', sourceNodeId: 'video-ref', origin: 'connection' },
      { kind: 'audio', sourceNodeId: 'audio-ref', origin: 'connection' },
    ]);
    expect(getMediaReferenceUrls(media.references, 'audio', 'local')).toEqual([
      'asset://localhost/reference.wav',
    ]);
  });

  it('deduplicates by media kind and local URL while preserving first-source metadata', () => {
    const first = {
      kind: 'audio' as const,
      url: 'asset://localhost/reference.wav',
      origin: 'prompt' as const,
      role: 'reference_audio' as const,
      sourceNodeId: 'prompt-audio',
    };
    const merged = mergeMediaReferences(
      [first],
      [
        { ...first, origin: 'connection', sourceNodeId: 'connected-audio' },
        { ...first, kind: 'video', role: 'reference' },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ origin: 'prompt', sourceNodeId: 'prompt-audio' });
    expect(merged[1].kind).toBe('video');
  });
});

describe('manual frame and character references', () => {
  it('reorders references by the node 首帧/尾帧 picks and keeps 参考角色 as plain references', async () => {
    const imageNode = (id: string, url: string): Node<BaseNodeData> => ({
      id,
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: { label: id, type: 'ai-image', imageUrl: url },
    });
    const videoNode: Node<BaseNodeData> = {
      id: 'video-1',
      type: 'ai-video',
      position: { x: 0, y: 0 },
      data: {
        label: '镜头',
        type: 'ai-video',
        videoReferences: [
          { id: 'image-c', kind: 'frame', role: 'first_frame', url: 'https://cdn.example/c.png', sourceNodeId: 'image-c' },
          { id: 'image-a', kind: 'frame', role: 'last_frame', url: 'https://cdn.example/a.png', sourceNodeId: 'image-a' },
          { id: 'character:hero', kind: 'character', role: 'reference', url: 'https://cdn.example/hero.png', label: '主角' },
        ],
      },
    };
    useAppStore.setState({
      nodes: [
        imageNode('image-a', 'https://cdn.example/a.png'),
        imageNode('image-b', 'https://cdn.example/b.png'),
        imageNode('image-c', 'https://cdn.example/c.png'),
        videoNode,
      ],
      edges: ['image-a', 'image-b', 'image-c'].map((source) => ({
        id: `e-${source}`,
        source,
        target: 'video-1',
      })),
    });

    let captured: VideoGenerationReferenceInput | null = null;
    const unregister = mediaProviderRegistry.register({
      providerId: 'test-frame-role-provider',
      capabilities: ['video'],
      async generateVideo({ resolveReferenceInput }) {
        captured = await resolveReferenceInput();
        return { url: 'https://cdn.example/result.mp4' };
      },
    });

    try {
      await generateVideo({
        prompt: '推进镜头',
        model: 'test/frame-roles',
        provider: 'test-frame-role-provider',
        nodeId: 'video-1',
      });
    } finally {
      unregister();
    }

    const referenceInput = captured as VideoGenerationReferenceInput | null;
    // 首帧 → 参考角色/中间图 → 尾帧；连线里没被挑中的图仍按原顺序留在中间
    expect(referenceInput?.imageUrls).toEqual([
      'https://cdn.example/c.png',
      'https://cdn.example/hero.png',
      'https://cdn.example/b.png',
      'https://cdn.example/a.png',
    ]);
    expect(referenceInput?.references?.map((reference) => reference.role)).toEqual([
      'first_frame',
      'reference',
      'reference',
      'last_frame',
    ]);
  });

  it('tells the model which reference image the mentioned character name refers to', async () => {
    const videoNode: Node<BaseNodeData> = {
      id: 'video-1',
      type: 'ai-video',
      position: { x: 0, y: 0 },
      data: {
        label: '镜头',
        type: 'ai-video',
        videoReferences: [
          { id: 'img-a', kind: 'frame', role: 'first_frame', url: 'https://cdn.example/room.png' },
          { id: 'character:hero', kind: 'character', role: 'reference', url: 'https://cdn.example/hero.png', label: '女主·林夏' },
          { id: 'character:extra', kind: 'character', role: 'reference', url: 'https://cdn.example/extra.png', label: '路人甲' },
        ],
      },
    };
    useAppStore.setState({ nodes: [videoNode] });

    let captured: VideoGenerationReferenceInput | null = null;
    const unregister = mediaProviderRegistry.register({
      providerId: 'test-character-provider',
      capabilities: ['video'],
      async generateVideo({ resolveReferenceInput }) {
        captured = await resolveReferenceInput();
        return { url: 'https://cdn.example/result.mp4' };
      },
    });

    try {
      await generateVideo({
        prompt: '林夏推开门走进房间',
        model: 'test/character',
        provider: 'test-character-provider',
        nodeId: 'video-1',
      });
    } finally {
      unregister();
    }

    // 只标注被点名的角色，图号按最终提交顺序
    expect((captured as VideoGenerationReferenceInput | null)?.prompt)
      .toBe('林夏推开门走进房间\n\n（角色参考：图2 是林夏）');
  });

  it('leaves the prompt untouched when no character name is mentioned', () => {
    const items: VideoReferenceItem[] = [
      { id: 'character:hero', kind: 'character', role: 'reference', url: 'https://cdn.example/hero.png', label: '林夏' },
    ];
    expect(annotateCharacterReferences('推开门走进房间', items, ['https://cdn.example/hero.png']))
      .toBe('推开门走进房间');
  });

  it('leaves the connection order alone when nothing was picked', async () => {
    const imageNode = (id: string, url: string): Node<BaseNodeData> => ({
      id,
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: { label: id, type: 'ai-image', imageUrl: url },
    });
    useAppStore.setState({
      nodes: [
        imageNode('image-a', 'https://cdn.example/a.png'),
        imageNode('image-b', 'https://cdn.example/b.png'),
        { id: 'video-1', type: 'ai-video', position: { x: 0, y: 0 }, data: { label: '镜头', type: 'ai-video' } },
      ],
      edges: ['image-a', 'image-b'].map((source) => ({ id: `e-${source}`, source, target: 'video-1' })),
    });

    let captured: VideoGenerationReferenceInput | null = null;
    const unregister = mediaProviderRegistry.register({
      providerId: 'test-frame-default-provider',
      capabilities: ['video'],
      async generateVideo({ resolveReferenceInput }) {
        captured = await resolveReferenceInput();
        return { url: 'https://cdn.example/result.mp4' };
      },
    });

    try {
      await generateVideo({
        prompt: '推进镜头',
        model: 'test/frame-default',
        provider: 'test-frame-default-provider',
        nodeId: 'video-1',
      });
    } finally {
      unregister();
    }

    const referenceInput = captured as VideoGenerationReferenceInput | null;
    expect(referenceInput?.imageUrls).toEqual(['https://cdn.example/a.png', 'https://cdn.example/b.png']);
    expect(referenceInput?.references?.map((reference) => reference.role)).toEqual(['first_frame', 'last_frame']);
  });
});

describe('caller-supplied reference media', () => {
  // 剪辑窗口的 AI 转场没有画布节点可连线，只能直接把首/尾帧交给生成入口
  it('puts explicit references ahead of prompt references and keeps the frame roles', async () => {
    const imageNode: Node<BaseNodeData> = {
      id: 'image-1',
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: {
        label: '概念图',
        type: 'ai-image',
        imageUrl: 'https://cdn.example/concept.png',
      },
    };
    useAppStore.setState({ nodes: [imageNode] });

    let captured: VideoGenerationReferenceInput | null = null;
    const unregister = mediaProviderRegistry.register({
      providerId: 'test-transition-provider',
      capabilities: ['video'],
      async generateVideo({ resolveReferenceInput }) {
        captured = await resolveReferenceInput();
        return { url: 'https://cdn.example/transition.mp4' };
      },
    });

    try {
      await generateVideo({
        prompt: '穿过火光过渡 @{image-1:概念图}',
        model: 'test/transition',
        provider: 'test-transition-provider',
        referenceMedia: [
          { kind: 'image', url: 'asset://tail.png', origin: 'connection', role: 'reference' },
          { kind: 'image', url: 'asset://head.png', origin: 'connection', role: 'reference' },
        ],
      });
    } finally {
      unregister();
    }

    const referenceInput = captured as VideoGenerationReferenceInput | null;
    expect(referenceInput?.operation).toBe('image-to-video');
    expect(referenceInput?.imageUrls).toEqual([
      'asset://tail.png',
      'asset://head.png',
      'https://cdn.example/concept.png',
    ]);
    // 首帧固定是调用方给的第一张；尾帧是整串的最后一张
    expect(referenceInput?.references?.[0]).toMatchObject({
      url: 'asset://tail.png',
      role: 'first_frame',
    });
    expect(referenceInput?.references?.[1]).toMatchObject({
      url: 'asset://head.png',
      role: 'reference',
    });
    expect(referenceInput?.references?.at(-1)).toMatchObject({ role: 'last_frame' });
  });
});

describe('general video protocol variables', () => {
  it('derives the operation from the strongest referenced visual input', () => {
    expect(resolveVideoGenerationOperation([], [])).toBe('text-to-video');
    expect(resolveVideoGenerationOperation(['first.png'], [])).toBe('image-to-video');
    expect(resolveVideoGenerationOperation(['first.png'], ['reference.mp4'])).toBe('video-to-video');
  });

  it('maps duration controls and reference media to stable custom-protocol aliases', () => {
    const variables = buildGeneralVideoProtocolVariables(
      'doubao-seedance-2-0-260128',
      {
        model: 'general/seedance-2',
        provider: 'general',
        prompt: 'raw prompt',
        videoResolution: 1280,
        videoFps: 30,
        videoFrames: 129,
        seedanceResolution: '720p',
        seedanceRatio: '16:9',
        seedanceDuration: 6,
        generateAudio: true,
      },
      {
        prompt: 'resolved prompt',
        imageUrls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
        videoUrls: ['https://cdn.example/reference.mp4'],
        audioUrls: ['https://cdn.example/reference.mp3'],
        operation: 'video-to-video',
      },
    );

    expect(variables).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      prompt: 'resolved prompt',
      size: '1280x720',
      width: 1280,
      height: 720,
      aspectRatio: '16:9',
      frames: 181,
      frames8n1: 185,
      fps: 30,
      duration: 6,
      resolution: '720p',
      seedanceResolution: '720p',
      generateAudio: true,
      videoOperation: 'video-to-video',
      firstImage: 'https://cdn.example/first.png',
      lastImage: 'https://cdn.example/last.png',
      referenceImageUrls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
      referenceVideoUrl: 'https://cdn.example/reference.mp4',
      referenceVideoUrls: ['https://cdn.example/reference.mp4'],
      audioUrl: 'https://cdn.example/reference.mp3',
      referenceAudioUrls: ['https://cdn.example/reference.mp3'],
    });
  });

  it('provides usable defaults and omits a last frame when only one image is present', () => {
    const variables = buildGeneralVideoProtocolVariables(
      'video-model',
      { model: 'general/video', provider: 'general', prompt: 'prompt' },
      {
        prompt: 'prompt',
        imageUrls: ['https://cdn.example/only.png'],
        videoUrls: [],
        audioUrls: [],
        operation: 'image-to-video',
      },
    );

    expect(variables).toMatchObject({
      aspectRatio: '16:9',
      duration: 5,
      seedanceResolution: '720p',
      videoFrames: 121,
      videoFps: 24,
      firstImage: 'https://cdn.example/only.png',
      // 自建接口模型默认出有声视频
      generateAudio: true,
      videoOperation: 'image-to-video',
    });
    expect(variables.lastImage).toBeUndefined();
  });

  it('emits imageWithRoles array from reference roles for image_with_roles protocols', () => {
    const variables = buildGeneralVideoProtocolVariables(
      'video-model',
      { model: 'general/video', provider: 'general', prompt: 'prompt' },
      {
        prompt: 'prompt',
        imageUrls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
        videoUrls: [],
        audioUrls: [],
        operation: 'image-to-video',
        references: [
          { kind: 'image', role: 'first_frame', url: 'https://cdn.example/first.png', origin: 'connection' },
          { kind: 'image', role: 'last_frame', url: 'https://cdn.example/last.png', origin: 'connection' },
        ],
      },
    );

    expect(variables.imageWithRoles).toEqual([
      { url: 'https://cdn.example/first.png', role: 'first_frame' },
      { url: 'https://cdn.example/last.png', role: 'last_frame' },
    ]);
    // 独立字段仍按顺序推断，两种传参方式并存，由协议模板决定用哪个
    expect(variables.firstImage).toBe('https://cdn.example/first.png');
    expect(variables.lastImage).toBe('https://cdn.example/last.png');
  });
});

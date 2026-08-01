import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
import { useAppStore } from '../../src/store/useAppStore';
import type { BaseNodeData } from '../../src/types';

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
      frames: 129,
      frames8n1: 129,
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
      generateAudio: false,
      videoOperation: 'image-to-video',
    });
    expect(variables.lastImage).toBeUndefined();
  });
});

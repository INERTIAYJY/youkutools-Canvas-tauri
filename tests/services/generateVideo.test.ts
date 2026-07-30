import type { Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGeneralVideoProtocolVariables, generateVideo } from '../../src/services/ai/generateVideo';
import { resolvePromptWithImageRefs, resolvePromptWithMediaRefs } from '../../src/services/ai/promptResolver';
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
});

describe('general video protocol variables', () => {
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
    });
    expect(variables.lastImage).toBeUndefined();
  });
});

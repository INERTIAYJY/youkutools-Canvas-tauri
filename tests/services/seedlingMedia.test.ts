/**
 * seedlingMedia — Seedling 视频 Provider Adapter 参数映射测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoGenerationReferenceInput } from '../../src/types/aiTypes';
import type { MediaProviderRequest } from '../../src/services/ai/mediaProviderRegistry';

const seedlingMocks = vi.hoisted(() => ({
  createSeedlingVideoTask: vi.fn(),
  waitSeedlingTask: vi.fn(),
  toSeedlingDisplayUrl: vi.fn((url: string) => url),
}));

const uploadMocks = vi.hoisted(() => ({
  resolveMediaReferenceUrl: vi.fn(),
}));

vi.mock('../../src/services/seedlingService', () => seedlingMocks);
vi.mock('../../src/services/uploadService', () => uploadMocks);

import { seedlingMediaProviderAdapter } from '../../src/services/ai/providers/seedlingMedia';

function buildRequest(overrides?: {
  prompt?: string;
  seedanceDuration?: number;
  seedanceResolution?: string;
  seedanceRatio?: string;
  generateAudio?: boolean;
  references?: VideoGenerationReferenceInput['references'];
  imageUrls?: string[];
}): MediaProviderRequest {
  return {
    params: {
      prompt: '测试视频',
      model: 'seedling/quality',
      provider: 'seedling',
      seedanceDuration: overrides?.seedanceDuration ?? 5,
      seedanceResolution: overrides?.seedanceResolution ?? '720p',
      seedanceRatio: overrides?.seedanceRatio ?? '16:9',
      generateAudio: overrides?.generateAudio ?? false,
    },
    prompt: overrides?.prompt ?? '测试视频',
    resolveReferenceInput: async () => ({
      prompt: '测试视频',
      imageUrls: overrides?.imageUrls ?? [],
      videoUrls: [],
      audioUrls: [],
      operation: 'text-to-video',
      references: overrides?.references,
    }),
  };
}

beforeEach(() => {
  seedlingMocks.createSeedlingVideoTask.mockReset();
  seedlingMocks.waitSeedlingTask.mockReset();
  uploadMocks.resolveMediaReferenceUrl.mockReset();
  seedlingMocks.createSeedlingVideoTask.mockResolvedValue({ taskId: 10001 });
  seedlingMocks.waitSeedlingTask.mockResolvedValue({
    taskId: 10001,
    status: 'succeeded',
    videoUrl: 'https://cdn.example/seedling-video.mp4',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('seedlingMediaProviderAdapter.generateVideo', () => {
  it('提交文本生成任务并返回视频地址', async () => {
    const url = await seedlingMediaProviderAdapter.generateVideo!(buildRequest());
    expect(url).toEqual({ url: 'https://cdn.example/seedling-video.mp4' });
    expect(seedlingMocks.createSeedlingVideoTask).toHaveBeenCalledWith({
      prompt: '测试视频',
      model: 'quality',
      duration: 5,
      resolution: '720p',
      ratio: '16:9',
      audio: false,
      resources: [],
    });
    expect(seedlingMocks.waitSeedlingTask).toHaveBeenCalledWith(10001, undefined);
  });

  it('时长低于 4 秒时钳制到 4 秒（CLI 下限）', async () => {
    await seedlingMediaProviderAdapter.generateVideo!(
      buildRequest({ seedanceDuration: 2 }),
    );
    expect(seedlingMocks.createSeedlingVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 4 }),
    );
  });

  it('时长高于 15 秒时钳制到 15 秒（CLI 上限）', async () => {
    await seedlingMediaProviderAdapter.generateVideo!(
      buildRequest({ seedanceDuration: 30 }),
    );
    expect(seedlingMocks.createSeedlingVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 15 }),
    );
  });

  it('显式首尾帧按 首帧 → 参考 → 尾帧 排序传入 resources', async () => {
    const references = [
      { kind: 'image' as const, url: 'https://cdn.example/mid.png', role: 'reference' as const, origin: 'connection' as const },
      { kind: 'image' as const, url: 'https://cdn.example/last.png', role: 'last_frame' as const, origin: 'connection' as const },
      { kind: 'image' as const, url: 'https://cdn.example/first.png', role: 'first_frame' as const, origin: 'connection' as const },
    ];
    await seedlingMediaProviderAdapter.generateVideo!(
      buildRequest({ references, imageUrls: [] }),
    );
    expect(seedlingMocks.createSeedlingVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [
          'https://cdn.example/first.png',
          'https://cdn.example/mid.png',
          'https://cdn.example/last.png',
        ],
      }),
    );
  });

  it('本地磁盘路径直接交给 CLI（CLI 自动上传），asset URL 走通用图床', async () => {
    uploadMocks.resolveMediaReferenceUrl.mockImplementation(async (url: string) => {
      if (url === 'asset.localhost/ref.png') return 'https://cdn.example/uploaded.png';
      return url;
    });
    await seedlingMediaProviderAdapter.generateVideo!(
      buildRequest({
        imageUrls: ['C:\\project\\frames\\a.png', 'asset.localhost/ref.png'],
      }),
    );
    expect(seedlingMocks.createSeedlingVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: ['C:\\project\\frames\\a.png', 'https://cdn.example/uploaded.png'],
      }),
    );
    expect(uploadMocks.resolveMediaReferenceUrl).toHaveBeenCalledWith(
      'asset.localhost/ref.png',
      { kind: 'image' },
    );
  });

  it('任务失败时抛出服务端错误信息', async () => {
    seedlingMocks.waitSeedlingTask.mockRejectedValue(
      new Error('任务失败: OutputVideoSensitiveContentDetected'),
    );
    await expect(
      seedlingMediaProviderAdapter.generateVideo!(buildRequest()),
    ).rejects.toThrow('OutputVideoSensitiveContentDetected');
  });

  it('任务成功但无视频地址时报错', async () => {
    seedlingMocks.waitSeedlingTask.mockResolvedValue({
      taskId: 10001,
      status: 'succeeded',
      videoUrl: null,
      errorMessage: '未生成产物',
    });
    await expect(
      seedlingMediaProviderAdapter.generateVideo!(buildRequest()),
    ).rejects.toThrow('未生成产物');
  });
});

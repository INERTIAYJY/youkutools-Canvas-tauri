import { describe, expect, it } from 'vitest';
import { buildDreaminaVideoParams } from '../../src/services/dreaminaService';
import type { MediaReference } from '../../src/types/aiTypes';

const reference = (
  kind: MediaReference['kind'],
  url: string,
  role: MediaReference['role'] = 'reference',
): MediaReference => ({ kind, url, role, origin: 'connection' });

describe('即梦 CLI 视频命令路由', () => {
  it('纯文本使用 text2video 并保留 Seedance 2.5 的 1080p/30 秒', () => {
    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.5',
      prompt: '生成视频',
      references: [],
      ratio: '9:16',
      duration: 30,
      resolution: '1080p',
    })).toEqual({
      kind: 'text2video',
      prompt: '生成视频',
      modelVersion: 'seedance2.5',
      ratio: '9:16',
      duration: 30,
      videoResolution: '1080p',
    });
  });

  it('单张图片使用 image2video，明确首尾帧使用 frames2video', () => {
    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.0_vip',
      prompt: '推进镜头',
      references: [reference('image', 'asset://first.png', 'first_frame')],
    })).toMatchObject({
      kind: 'image2video',
      image: 'asset://first.png',
      videoResolution: '720p',
    });

    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.0_vip',
      prompt: '首尾帧过渡',
      references: [
        reference('image', 'asset://first.png', 'first_frame'),
        reference('image', 'asset://last.png', 'last_frame'),
      ],
      resolution: '4k',
    })).toMatchObject({
      kind: 'frames2video',
      first: 'asset://first.png',
      last: 'asset://last.png',
      videoResolution: '4k',
    });
  });

  it('混合图片、视频、音频使用 multimodal2video', () => {
    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.5',
      prompt: '参考全部素材',
      references: [
        reference('image', 'asset://image.png'),
        reference('video', 'asset://video.mp4'),
        reference('audio', 'asset://audio.mp3', 'reference_audio'),
      ],
    })).toMatchObject({
      kind: 'multimodal2video',
      images: ['asset://image.png'],
      videos: ['asset://video.mp4'],
      audios: ['asset://audio.mp3'],
    });
  });

  it('仅 Seedance 2.5 允许纯音频参考，并在前端拦截旧模型', () => {
    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.5',
      prompt: '跟随节奏',
      references: [reference('audio', 'asset://audio.mp3', 'reference_audio')],
    }).kind).toBe('multimodal2video');

    expect(() => buildDreaminaVideoParams({
      model: 'dreamina/seedance2.0mini',
      prompt: '跟随节奏',
      references: [reference('audio', 'asset://audio.mp3', 'reference_audio')],
    })).toThrow('至少需要一张参考图或一个参考视频');
  });

  it('旧节点中的非法规格会收敛到模型默认值', () => {
    expect(buildDreaminaVideoParams({
      model: 'dreamina/seedance2.0mini',
      prompt: '生成视频',
      references: [],
      ratio: 'adaptive',
      duration: 30,
      resolution: '1080p',
    })).toMatchObject({
      ratio: '16:9',
      duration: 15,
      videoResolution: '720p',
    });
  });
});

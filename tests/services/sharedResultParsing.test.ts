/**
 * 正常生成与重启恢复共用的结果解析。
 *
 * 这两处逻辑原本各有一份副本，且已经跑偏：恢复路径的副本不拆逗号拼接的 URL，
 * 同一份响应在正常生成下拿到干净地址、恢复后拿到整条拼接串。副本已合并，
 * 这里把合并后的行为钉住，防止将来再各自复制一份。
 */
import { describe, expect, it } from 'vitest';
import { parseMultiPathResponse } from '../../src/services/ai/helpers';
import { buildComfyFileUrl } from '../../src/services/comfyOutputs';

describe('parseMultiPathResponse', () => {
  it('splits comma-joined url arrays instead of returning the whole string', () => {
    const parsed = parseMultiPathResponse(
      { videos: [{ url: ['https://cdn.test/a.mp4,https://cdn.test/b.mp4'] }] },
      'videos',
    );
    expect(parsed).toBe('https://cdn.test/a.mp4');
  });

  it('reads the primary field before falling back', () => {
    const parsed = parseMultiPathResponse(
      {
        audios: [{ url: ['https://cdn.test/voice.mp3'] }],
        images: [{ url: ['https://cdn.test/cover.png'] }],
      },
      'audios',
    );
    expect(parsed).toBe('https://cdn.test/voice.mp3');
  });

  it('falls back to images when the primary field is missing or empty', () => {
    expect(parseMultiPathResponse({ images: [{ url: ['https://cdn.test/a.png'] }] }, 'videos'))
      .toBe('https://cdn.test/a.png');
    expect(parseMultiPathResponse({ videos: [], images: [{ url: 'https://cdn.test/b.png' }] }, 'videos'))
      .toBe('https://cdn.test/b.png');
  });

  it('accepts a plain string url as well as an array', () => {
    expect(parseMultiPathResponse({ videos: [{ url: 'https://cdn.test/a.mp4' }] }, 'videos'))
      .toBe('https://cdn.test/a.mp4');
  });

  it('returns undefined when nothing carries a url', () => {
    expect(parseMultiPathResponse({}, 'videos')).toBeUndefined();
    expect(parseMultiPathResponse({ videos: [{}], images: [{}] }, 'videos')).toBeUndefined();
    expect(parseMultiPathResponse({ videos: 'not-an-array' }, 'videos')).toBeUndefined();
  });

  it('honours custom fallback fields', () => {
    const parsed = parseMultiPathResponse(
      { data: [{ url: 'https://cdn.test/from-data.png' }] },
      'videos',
      ['data'],
    );
    expect(parsed).toBe('https://cdn.test/from-data.png');
  });
});

describe('buildComfyFileUrl', () => {
  it('defaults to the output type when the file does not declare one', () => {
    expect(buildComfyFileUrl('http://127.0.0.1:8188', { filename: 'a.png' }))
      .toBe('http://127.0.0.1:8188/view?filename=a.png&type=output');
  });

  it('encodes the subfolder and type it was given', () => {
    expect(buildComfyFileUrl('http://127.0.0.1:8188', {
      filename: '第 1 帧.png',
      subfolder: 'sub dir',
      type: 'temp',
    })).toBe('http://127.0.0.1:8188/view?filename=%E7%AC%AC%201%20%E5%B8%A7.png&subfolder=sub%20dir&type=temp');
  });
});

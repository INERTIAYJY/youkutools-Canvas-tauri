/**
 * videoPlaybackCompat — 回归测试：HEVC/H.265 视频转码与播放兼容。
 *
 * 覆盖三条路径：生成结果落盘后转码、外部导入转码替换、播放报错兜底修复。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${path}`),
  showToast: vi.fn(),
  isTauri: true,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: mocks.convertFileSrc,
}));

vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ showToast: mocks.showToast }),
  },
}));

vi.mock('../../src/services/fs/core', () => ({
  isTauriEnv: () => mocks.isTauri,
}));

import {
  ensurePlayableVideoFile,
  playableVideoUrl,
  probeVideoCodec,
  repairUnplayableVideoFile,
  transcodeImportedVideo,
} from '../../src/services/videoPlaybackCompat';

describe('videoPlaybackCompat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri = true;
    mocks.convertFileSrc.mockImplementation((path: string) => `http://asset.localhost/${path}`);
  });

  it('只把 HEVC 交给转码，其余编码原样返回', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'h264' };
      throw new Error(`不应调用 ${command}`);
    });

    await expect(ensurePlayableVideoFile('C:/p/a.mp4')).resolves.toBe('C:/p/a.mp4');
    expect(mocks.invoke).not.toHaveBeenCalledWith('video_transcode_h264', expect.anything());
  });

  it('HEVC 时按需准备 ffmpeg 并返回转码后的路径', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: false, source: 'missing' };
      if (command === 'ffmpeg_ensure') return { found: true, source: 'managed' };
      if (command === 'video_transcode_h264') {
        expect(args?.inputPath).toBe('C:/p/a.mp4');
        return { path: 'C:/p/a_h264.mp4', codec: 'h264', transcoded: true };
      }
      throw new Error(`未知命令 ${command}`);
    });

    await expect(ensurePlayableVideoFile('C:/p/a.mp4')).resolves.toBe('C:/p/a_h264.mp4');
    expect(mocks.invoke).toHaveBeenCalledWith('ffmpeg_status');
    expect(mocks.invoke).toHaveBeenCalledWith('ffmpeg_ensure');
  });

  it('已经是 H.264 时不重复下载 ffmpeg', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: true, source: 'system' };
      if (command === 'video_transcode_h264') return { path: 'C:/p/a_h264.mp4', codec: 'h264', transcoded: true };
      throw new Error(`未知命令 ${command}`);
    });

    await expect(ensurePlayableVideoFile('C:/p/a.mp4')).resolves.toBe('C:/p/a_h264.mp4');
    expect(mocks.invoke).not.toHaveBeenCalledWith('ffmpeg_ensure');
  });

  it('转码失败时保留原路径并提示原因，不抛出', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: true, source: 'system' };
      if (command === 'video_transcode_h264') throw new Error('磁盘空间不足');
      throw new Error(`未知命令 ${command}`);
    });

    await expect(ensurePlayableVideoFile('C:/p/a.mp4')).resolves.toBe('C:/p/a.mp4');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('磁盘空间不足'), 'error');
  });

  it('非桌面环境与不支持的容器不触发原生调用', async () => {
    mocks.isTauri = false;
    await expect(ensurePlayableVideoFile('C:/p/a.mp4')).resolves.toBe('C:/p/a.mp4');
    mocks.isTauri = true;
    await expect(ensurePlayableVideoFile('C:/p/a.mkv')).resolves.toBe('C:/p/a.mkv');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('导入转码：命中 HEVC 时替换工程副本并报告替换结果', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: true, source: 'system' };
      if (command === 'video_transcode_h264') {
        expect(args?.inputPath).toBe('C:/p/a.mp4');
        return { path: 'C:/p/a_h264.mp4', codec: 'h264', transcoded: true };
      }
      throw new Error(`未知命令 ${command}`);
    });

    await expect(transcodeImportedVideo('C:/p/a.mp4')).resolves.toEqual({
      path: 'C:/p/a_h264.mp4',
      replaced: true,
    });
  });

  it('导入转码：H.264 原样导入，不标记替换', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'h264' };
      throw new Error(`不应调用 ${command}`);
    });

    await expect(transcodeImportedVideo('C:/p/a.mp4')).resolves.toEqual({
      path: 'C:/p/a.mp4',
      replaced: false,
    });
  });

  it('导入转码失败时保留原文件并提示', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: true, source: 'system' };
      if (command === 'video_transcode_h264') throw new Error('ffmpeg 退出码 1');
      throw new Error(`未知命令 ${command}`);
    });

    await expect(transcodeImportedVideo('C:/p/a.mp4')).resolves.toEqual({
      path: 'C:/p/a.mp4',
      replaced: false,
    });
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('ffmpeg 退出码 1'), 'error');
  });

  it('播放兜底修复：转码成功才报告 repaired', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'hevc' };
      if (command === 'ffmpeg_status') return { found: true, source: 'system' };
      if (command === 'video_transcode_h264') return { path: 'C:/p/a_h264.mp4', codec: 'h264', transcoded: true };
      throw new Error(`未知命令 ${command}`);
    });

    await expect(repairUnplayableVideoFile('C:/p/a.mp4')).resolves.toEqual({
      path: 'C:/p/a_h264.mp4',
      repaired: true,
    });
  });

  it('播放兜底修复：不是 HEVC 时不修复，也不提示错误', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'video_probe_codec') return { codec: 'av1' };
      throw new Error(`不应调用 ${command}`);
    });

    await expect(repairUnplayableVideoFile('C:/p/a.mp4')).resolves.toEqual({
      path: 'C:/p/a.mp4',
      repaired: false,
    });
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('探测失败时按 unknown 处理', async () => {
    mocks.invoke.mockImplementation(async () => ({}));
    await expect(probeVideoCodec('C:/p/a.mp4')).resolves.toBe('unknown');
  });

  it('本地路径转换为可播放的 asset 地址', () => {
    expect(playableVideoUrl('C:/p/a.mp4')).toBe('http://asset.localhost/C:/p/a.mp4');
  });
});

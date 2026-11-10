/**
 * 视频播放兼容：森之灵新版服务端会输出 HEVC Main10(10bit)，WebView2 无法解码，
 * 表现为「视频格式或编码不兼容」。这里在结果落盘后探测编码，遇到 HEVC 时按需
 * 准备 ffmpeg 并转成 H.264，返回可播放的本地路径；整个过程失败不阻断生成，
 * 只提示并保留原片。
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { isTauriEnv } from './fs/core';

export interface VideoCodecProbe {
  codec: 'h264' | 'hevc' | 'av1' | 'unknown' | string;
}

export interface FfmpegStatus {
  found: boolean;
  path?: string;
  source: string;
}

export interface VideoTranscodeResult {
  path: string;
  codec: string;
  transcoded: boolean;
}

/** 读取 MP4 sample entry 判断编码，不依赖 ffmpeg。 */
export async function probeVideoCodec(filePath: string): Promise<string> {
  const probe = await invoke<VideoCodecProbe>('video_probe_codec', { path: filePath });
  return probe?.codec ?? 'unknown';
}

/**
 * 确保视频可被 WebView 播放：HEVC 时转成 H.264 并返回新路径，其余情况原样返回。
 * 任何失败都返回原路径，不阻断生成流程。
 */
export async function ensurePlayableVideoFile(
  filePath: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!filePath || !isTauriEnv() || !/\.mp4$/i.test(filePath)) return filePath;
  if (signal?.aborted) return filePath;
  try {
    const codec = await probeVideoCodec(filePath);
    if (codec !== 'hevc') return filePath;
    const status = await invoke<FfmpegStatus>('ffmpeg_status');
    if (!status?.found) {
      useAppStore.getState().showToast('该视频为 HEVC 编码，正在准备解码组件（首次约 80MB），请稍候…');
      await invoke<FfmpegStatus>('ffmpeg_ensure');
    }
    const result = await invoke<VideoTranscodeResult>('video_transcode_h264', { inputPath: filePath });
    if (!result?.path || !result.transcoded) return filePath;
    useAppStore.getState().showToast('视频已转为 H.264，可直接播放（原片保留）');
    return result.path;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    useAppStore.getState().showToast(`视频为 HEVC 编码，转码失败：${detail}`, 'error');
    return filePath;
  }
}

/** 本地文件路径 → WebView 可加载的 asset 地址。 */
export function playableVideoUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

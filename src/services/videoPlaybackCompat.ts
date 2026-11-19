/**
 * 视频播放兼容：森之灵新版服务端会输出 HEVC Main10(10bit)，WebView2 无法解码，
 * 表现为「视频格式或编码不兼容」。这里在结果落盘后探测编码，遇到 HEVC 时按需
 * 准备 ffmpeg 并转成 H.264，返回可播放的本地路径；整个过程失败不阻断生成，
 * 只提示并保留原片。
 *
 * 三个入口共用同一套原生能力：
 * 1. 生成结果落盘后转码（generationService / AINodeDialog / generationRuntime）；
 * 2. 外部拖入的 HEVC 视频自动转码并替换工程内副本（受设置开关控制）；
 * 3. 播放器报编码不兼容时，按节点已有文件路径兜底修复并回写节点。
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

/** 可交给 WebView 播放的容器；其他容器（mkv/avi 等）WebView2 同样解不了，但转码前不改名。 */
const PLAYABLE_VIDEO_EXT = /\.(mp4|m4v|mov)$/i;

/** 读取 MP4 sample entry 判断编码，不依赖 ffmpeg。 */
export async function probeVideoCodec(filePath: string): Promise<string> {
  const probe = await invoke<VideoCodecProbe>('video_probe_codec', { path: filePath });
  return probe?.codec ?? 'unknown';
}

/** ffmpeg 缺失时按需下载；已存在则直接返回。 */
async function ensureFfmpeg(): Promise<void> {
  const status = await invoke<FfmpegStatus>('ffmpeg_status');
  if (status?.found) return;
  useAppStore.getState().showToast('该视频为 HEVC 编码，正在准备解码组件（首次约 80MB），请稍候…');
  await invoke<FfmpegStatus>('ffmpeg_ensure');
}

/**
 * 把 HEVC 视频转成 H.264 并返回新路径。
 * 非 HEVC、非桌面端或任何失败都返回原路径，不抛错、不阻断调用方流程。
 */
async function transcodeToH264(
  filePath: string,
  outputPath?: string,
): Promise<{ path: string; transcoded: boolean }> {
  const codec = await probeVideoCodec(filePath);
  if (codec !== 'hevc') return { path: filePath, transcoded: false };
  await ensureFfmpeg();
  const result = await invoke<VideoTranscodeResult>('video_transcode_h264', {
    inputPath: filePath,
    ...(outputPath ? { outputPath } : {}),
  });
  if (!result?.path || !result.transcoded) return { path: filePath, transcoded: false };
  return { path: result.path, transcoded: true };
}

/**
 * 确保视频可被 WebView 播放：HEVC 时转成 H.264 并返回新路径，其余情况原样返回。
 * 任何失败都返回原路径，不阻断生成流程。
 */
export async function ensurePlayableVideoFile(
  filePath: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!filePath || !isTauriEnv() || !PLAYABLE_VIDEO_EXT.test(filePath)) return filePath;
  if (signal?.aborted) return filePath;
  try {
    const { path, transcoded } = await transcodeToH264(filePath);
    if (!transcoded) return filePath;
    useAppStore.getState().showToast('视频已转为 H.264，可直接播放（原片保留）');
    return path;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    useAppStore.getState().showToast(`视频为 HEVC 编码，转码失败：${detail}`, 'error');
    return filePath;
  }
}

/**
 * 外部导入的视频转码入口：命中 HEVC 时把工程内副本换成 H.264 版本。
 *
 * 只处理工程目录内的副本，外部原文件绝不改动；原副本交给调用方回收，
 * 便于撤销。返回替换后的路径，未发生替换时返回原路径。
 */
export async function transcodeImportedVideo(
  filePath: string,
  options?: { signal?: AbortSignal; silent?: boolean },
): Promise<{ path: string; replaced: boolean }> {
  if (!filePath || !isTauriEnv() || !PLAYABLE_VIDEO_EXT.test(filePath)) {
    return { path: filePath, replaced: false };
  }
  if (options?.signal?.aborted) return { path: filePath, replaced: false };
  try {
    const { path, transcoded } = await transcodeToH264(filePath);
    if (!transcoded) return { path: filePath, replaced: false };
    if (!options?.silent) {
      useAppStore.getState().showToast('已导入的 H.265 视频自动转为 H.264，可直接播放');
    }
    return { path, replaced: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    useAppStore.getState().showToast(`H.265 视频转码失败：${detail}`, 'error');
    return { path: filePath, replaced: false };
  }
}

/**
 * 播放器报编码不兼容时的兜底修复：按节点已有文件路径重新探测并转码。
 * 成功时返回新路径，由调用方回写节点数据；未修复时返回原路径。
 */
export async function repairUnplayableVideoFile(
  filePath: string | undefined,
): Promise<{ path: string; repaired: boolean }> {
  if (!filePath || !isTauriEnv() || !PLAYABLE_VIDEO_EXT.test(filePath)) {
    return { path: filePath ?? '', repaired: false };
  }
  try {
    const { path, transcoded } = await transcodeToH264(filePath);
    if (!transcoded) return { path: filePath, repaired: false };
    useAppStore.getState().showToast('视频编码不兼容，已自动转为 H.264');
    return { path, repaired: true };
  } catch {
    return { path: filePath, repaired: false };
  }
}

/** 本地文件路径 → WebView 可加载的 asset 地址。 */
export function playableVideoUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

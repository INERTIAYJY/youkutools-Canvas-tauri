/**
 * 音频混流 —— 把多条轨道的音频按时间轴位置与音量包络叠加成一条。
 *
 * 解码走 mediabunny 的 AudioBufferSink，混合在普通 Float32 缓冲上手工完成，
 * 不依赖 OfflineAudioContext（它在 WebView 里对超长音频容易顶到限制）。
 */
import { AudioBufferSink, type Input } from 'mediabunny';
import {
  evaluateVolume,
  getClipDuration,
  type VideoEditorClip,
  type VideoEditorTrack,
} from '../types/videoEditor';

export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;

export type ClipAudioResolver = (clip: VideoEditorClip) => Input | undefined;

/** 混流结果：交错前的分声道数据，可直接塞进 AudioBuffer */
export interface MixedAudio {
  channels: MixChannel[];
  sampleRate: number;
  length: number;
}

// AudioBuffer.copyToChannel 要求底层是 ArrayBuffer 而非 SharedArrayBuffer，
// 显式标注类型参数以满足这个约束
type MixChannel = Float32Array<ArrayBuffer>;

function createChannels(length: number): MixChannel[] {
  return Array.from(
    { length: MIX_CHANNELS },
    () => new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT)),
  );
}

/**
 * 把一个片段的音频叠加进目标缓冲。
 *
 * 增益逐样本取自音量包络，因此淡入淡出是连续的而非阶梯状。
 */
async function mixClip(
  target: MixChannel[],
  totalLength: number,
  clip: VideoEditorClip,
  input: Input,
  trackVolume: number,
): Promise<void> {
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack || !(await audioTrack.canDecode())) return;

  const sink = new AudioBufferSink(audioTrack);
  const clipDuration = getClipDuration(clip);

  for await (const wrapped of sink.buffers(clip.sourceIn, clip.sourceOut)) {
    const buffer = wrapped.buffer;
    // 素材时间 → 片段内相对时间 → 时间轴绝对时间
    const timeInClip = wrapped.timestamp - clip.sourceIn;
    if (timeInClip >= clipDuration) break;

    const startSample = Math.round((clip.timelineStart + timeInClip) * MIX_SAMPLE_RATE);
    const ratio = buffer.sampleRate / MIX_SAMPLE_RATE;

    for (let channel = 0; channel < MIX_CHANNELS; channel += 1) {
      // 单声道素材复制到两个声道
      const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
      const data = buffer.getChannelData(sourceChannel);
      const out = target[channel];

      for (let index = 0; index < Math.round(buffer.duration * MIX_SAMPLE_RATE); index += 1) {
        const destIndex = startSample + index;
        if (destIndex < 0 || destIndex >= totalLength) continue;
        // 最近邻重采样：剪辑场景下足够，且避免引入额外依赖
        const sourceIndex = Math.floor(index * ratio);
        if (sourceIndex >= data.length) break;

        const gain = evaluateVolume(clip, timeInClip + index / MIX_SAMPLE_RATE) * trackVolume;
        out[destIndex] += data[sourceIndex] * gain;
      }
    }
  }
}

/** 把混合结果限幅到 [-1, 1]，避免多轨叠加后削顶产生爆音 */
function limit(channels: MixChannel[]): void {
  let peak = 1;
  for (const channel of channels) {
    for (const value of channel) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }
  if (peak <= 1) return;
  const scale = 1 / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
  }
}

/**
 * 混合时间轴上所有未静音轨道的音频。
 * 没有任何可用音频时返回 null，调用方据此决定是否给输出加音轨。
 */
export async function mixTimelineAudio(options: {
  tracks: VideoEditorTrack[];
  duration: number;
  resolve: ClipAudioResolver;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<MixedAudio | null> {
  const { tracks, duration, resolve, onProgress, signal } = options;
  if (duration <= 0) return null;

  const totalLength = Math.ceil(duration * MIX_SAMPLE_RATE);
  const channels = createChannels(totalLength);

  const jobs: { clip: VideoEditorClip; input: Input; trackVolume: number }[] = [];
  for (const track of tracks) {
    if (track.hidden || track.muted) continue;
    for (const clip of track.clips) {
      if (clip.kind === 'image') continue;
      const input = resolve(clip);
      if (input) jobs.push({ clip, input, trackVolume: track.volume ?? 1 });
    }
  }
  if (jobs.length === 0) return null;

  let mixed = 0;
  for (const job of jobs) {
    if (signal?.aborted) throw new Error('导出已取消');
    await mixClip(channels, totalLength, job.clip, job.input, job.trackVolume);
    mixed += 1;
    onProgress?.(mixed / jobs.length);
  }

  limit(channels);
  return { channels, sampleRate: MIX_SAMPLE_RATE, length: totalLength };
}

/** 把混流结果切成若干 AudioBuffer，便于按块喂给编码器 */
export function toAudioBuffers(
  mixed: MixedAudio,
  chunkSeconds = 1,
): AudioBuffer[] {
  const chunkLength = Math.max(1, Math.round(chunkSeconds * mixed.sampleRate));
  const buffers: AudioBuffer[] = [];

  for (let offset = 0; offset < mixed.length; offset += chunkLength) {
    const length = Math.min(chunkLength, mixed.length - offset);
    const buffer = new AudioBuffer({
      length,
      numberOfChannels: MIX_CHANNELS,
      sampleRate: mixed.sampleRate,
    });
    for (let channel = 0; channel < MIX_CHANNELS; channel += 1) {
      buffer.copyToChannel(mixed.channels[channel].subarray(offset, offset + length), channel);
    }
    buffers.push(buffer);
  }
  return buffers;
}

/**
 * 抽取音频波形包络，用于在音频片段上画波形。
 *
 * 只取峰值而非全部样本：`buckets` 个桶覆盖整段素材，
 * 每桶记录该区间内的最大绝对振幅。
 */
export async function extractWaveform(
  input: Input,
  options: { buckets: number; duration: number },
): Promise<number[]> {
  const { buckets, duration } = options;
  if (buckets <= 0 || duration <= 0) return [];

  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack || !(await audioTrack.canDecode())) return [];

  const peaks = new Array<number>(buckets).fill(0);
  const sink = new AudioBufferSink(audioTrack);

  for await (const wrapped of sink.buffers()) {
    const buffer = wrapped.buffer;
    const data = buffer.getChannelData(0);
    const step = buffer.duration / Math.max(1, data.length);

    for (let index = 0; index < data.length; index += 1) {
      const time = wrapped.timestamp + index * step;
      const bucket = Math.floor((time / duration) * buckets);
      if (bucket < 0 || bucket >= buckets) continue;
      const magnitude = Math.abs(data[index]);
      if (magnitude > peaks[bucket]) peaks[bucket] = magnitude;
    }
  }
  return peaks;
}

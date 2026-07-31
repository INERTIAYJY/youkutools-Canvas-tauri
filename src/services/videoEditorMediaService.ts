/**
 * 剪辑媒体服务 — 基于 mediabunny (MPL-2.0) 的解码、缩略图与裁剪导出
 *
 * 输入统一走 CustomSource + HTTP Range，避免把整个视频读进内存：
 * Tauri 的 asset:// 协议支持 Range（<video> 拖动进度条依赖它），
 * 不支持时回退成一次性 Blob 读取。
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  CustomSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
} from 'mediabunny';
import type {
  VideoEditorCanvasSize,
  VideoEditorSourceProbe,
  VideoEditorTrack,
} from '../types/videoEditor';
import { renderFrameAt, type ClipSourceResolver } from './videoCompositor';
import { mixTimelineAudio, toAudioBuffers, type ClipAudioResolver } from './videoAudioMixer';

/** 单次 Range 请求的上限，超出由 mediabunny 自行分片 */
const MAX_RANGE_BYTES = 8 * 1024 * 1024;

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  // Range 是闭区间，mediabunny 的 end 是开区间
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (!response.ok) {
    throw new Error(`读取媒体分片失败：HTTP ${response.status}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  // 服务端忽略了 Range（返回 200 全量）时自行裁切，避免调用方拿到超量数据
  if (response.status !== 206 && buffer.byteLength > end - start) {
    return buffer.subarray(start, end);
  }
  return buffer;
}

/**
 * 分片读取的自愈包装。
 *
 * 导出时 Conversion 会并发发起大量分片请求，WKWebView 的 asset:// 处理器
 * 在这种压力下会让 fetch 直接失败（WebKit 报 `TypeError: Type error`）。
 * 这里先退避重试一次，仍失败则整份下载一次并转为内存切片，
 * 让后续所有读取都不再依赖 asset:// 的并发表现。
 */
export function createResilientReader(url: string, size: number) {
  let wholeFile: Promise<Uint8Array> | null = null;

  const loadWholeFile = () => {
    wholeFile ??= (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`读取媒体失败：HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    return wholeFile;
  };

  return async (start: number, end: number): Promise<Uint8Array> => {
    const clampedEnd = Math.min(end, size);
    if (wholeFile) return (await wholeFile).subarray(start, clampedEnd);

    try {
      return await fetchRange(url, start, clampedEnd);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        return await fetchRange(url, start, clampedEnd);
      } catch {
        return (await loadWholeFile()).subarray(start, clampedEnd);
      }
    }
  };
}

/** 探测 URL 是否支持 Range，并取得文件总长度 */
async function probeRangeSupport(url: string): Promise<{ size: number; ranged: boolean } | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (!response.ok) return null;
    if (response.status === 206) {
      // Content-Range: bytes 0-0/12345
      const contentRange = response.headers.get('Content-Range');
      const total = contentRange?.split('/')[1];
      const size = total ? Number(total) : NaN;
      if (Number.isFinite(size) && size > 0) return { size, ranged: true };
    }
    const length = response.headers.get('Content-Length');
    const size = length ? Number(length) : NaN;
    if (Number.isFinite(size) && size > 0) return { size, ranged: false };
    return null;
  } catch {
    return null;
  }
}

/**
 * 为媒体 URL 建立 mediabunny 输入。
 * 支持 Range 时按需分片读取；否则整体下载成 Blob。
 */
export async function createVideoInput(url: string): Promise<Input> {
  const probe = await probeRangeSupport(url);

  if (probe?.ranged) {
    const read = createResilientReader(url, probe.size);
    return new Input({
      formats: ALL_FORMATS,
      source: new CustomSource({
        getSize: () => probe.size,
        read: (start, end) => read(start, Math.min(end, start + MAX_RANGE_BYTES)),
        maxCacheSize: MAX_RANGE_BYTES,
      }),
    });
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取媒体失败：HTTP ${response.status}`);
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(await response.blob()) });
}

/** 探测时长、分辨率与编解码可用性 */
export async function probeVideoSource(input: Input): Promise<VideoEditorSourceProbe> {
  const videoTrack = await input.getPrimaryVideoTrack();
  const audioTrack = await input.getPrimaryAudioTrack();

  const duration = await input.computeDuration();
  const decodable = videoTrack ? await videoTrack.canDecode() : false;

  return {
    duration,
    width: videoTrack?.displayWidth ?? 0,
    height: videoTrack?.displayHeight ?? 0,
    decodable,
    videoCodec: videoTrack ? await videoTrack.getCodec() : null,
    audioCodec: audioTrack ? await audioTrack.getCodec() : null,
  };
}

/**
 * 沿时间轴均匀抽取缩略图。
 * 用 canvasesAtTimestamps 的有序批量解码，避免逐帧 seek 造成重复解包。
 */
export async function extractThumbnails(
  input: Input,
  options: { count: number; height: number; duration: number },
): Promise<string[]> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack || !(await videoTrack.canDecode())) return [];

  const { count, height, duration } = options;
  if (count <= 0 || duration <= 0) return [];

  const sink = new CanvasSink(videoTrack, { height, fit: 'contain' });
  const timestamps = Array.from(
    { length: count },
    (_, index) => (duration * index) / count,
  );

  const thumbnails: string[] = [];
  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    if (!wrapped) {
      thumbnails.push('');
      continue;
    }
    const canvas = wrapped.canvas;
    thumbnails.push(
      canvas instanceof HTMLCanvasElement
        ? canvas.toDataURL('image/jpeg', 0.6)
        : '',
    );
  }
  return thumbnails;
}

/**
 * 让 `VideoEncoder.isConfigSupported` 的异常等价于「这个配置不支持」。
 *
 * mediabunny 会先试 `bitrateMode: 'quantizer'` 的候选配置，而 `'quantizer'`
 * 是 WebCodecs 后加的枚举值，WebKit 不认识它 —— 按 WebIDL 规则，字典里出现
 * 非法枚举值直接抛 TypeError（表现为 `TypeError: Type error`）。
 * mediabunny 没有接这种情况，于是整个导出崩掉，而**它后面还有一个
 * 普通 bitrate 候选本可以用**。这里把异常转成 `{supported:false}`，
 * 让它继续往下试，而不是一竿子判定本机不能编码。
 */
let encoderProbeGuarded = false;
export function guardEncoderProbe(): void {
  if (encoderProbeGuarded) return;
  encoderProbeGuarded = true;
  if (typeof VideoEncoder === 'undefined') return;

  const original = VideoEncoder.isConfigSupported.bind(VideoEncoder);
  VideoEncoder.isConfigSupported = async (config: VideoEncoderConfig) => {
    try {
      return await original(config);
    } catch (error) {
      console.warn('[videoEditor] isConfigSupported 拒绝了该配置，跳过该候选:', config, error);
      return { supported: false, config };
    }
  };
}

/** 轨道被丢弃的原因，用于把 mediabunny 的枚举翻成可读提示 */
const DISCARD_REASON_TEXT: Record<string, string> = {
  discarded_by_user: '轨道被主动丢弃',
  max_track_count_reached: '输出轨道数量已达上限',
  max_track_count_of_type_reached: '输出格式不支持该类型轨道',
  unknown_source_codec: '无法识别源编码格式',
  undecodable_source_codec: '当前系统无法解码该编码格式',
  no_encodable_target_codec: '当前系统缺少可用的编码器',
};

export class VideoExportCanceledError extends Error {
  constructor() {
    super('导出已取消');
    this.name = 'VideoExportCanceledError';
  }
}

/** 无损直通导出的结果；入点被吸附到关键帧，实际起点可能早于请求值 */
export type LosslessTrimResult = {
  bytes: Uint8Array;
  /** 实际生效的入点（最近的前置关键帧位置） */
  actualStart: number;
};

/**
 * 关键帧对齐的无损裁剪导出。
 *
 * mediabunny 的 `Conversion` 只要入点不等于轨道起点就强制重编码
 * （`firstTimestamp < startTimestamp`），而 WKWebView 上 4K 的
 * `VideoEncoder.isConfigSupported` 会直接抛 TypeError，导致导出不可用。
 *
 * 这里绕开 Conversion，直接搬运已编码分组：从入点前最近的关键帧开始，
 * 把分组原样写进新容器并把时间戳平移到零点。全程不碰编解码器，
 * 因此又快又不掉画质，代价是入点精度受关键帧间隔限制。
 */
export async function exportLosslessTrim(options: {
  input: Input;
  start: number;
  end: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<LosslessTrimResult> {
  const { input, start, end, onProgress, signal } = options;
  if (!(end > start)) throw new Error('导出区间无效：出点必须大于入点');

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('该文件没有可导出的视频轨');

  const videoCodec = await videoTrack.getCodec();
  if (!videoCodec) throw new Error('无法识别源视频编码，改用重编码导出');

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  if (!output.format.getSupportedVideoCodecs().includes(videoCodec)) {
    throw new Error(`MP4 容器不支持源编码 ${videoCodec}，改用重编码导出`);
  }

  const videoSource = new EncodedVideoPacketSource(videoCodec);
  output.addVideoTrack(videoSource, { rotation: videoTrack.rotation });

  // 音频轨可选：编码不被 MP4 接受时直接丢掉，总比整个导出失败好
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
  const keepAudio = !!audioTrack
    && !!audioCodec
    && output.format.getSupportedAudioCodecs().includes(audioCodec);
  const audioSource = keepAudio ? new EncodedAudioPacketSource(audioCodec) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  const throwIfAborted = () => {
    if (signal?.aborted) throw new VideoExportCanceledError();
  };

  try {
    const videoSink = new EncodedPacketSink(videoTrack);
    // 入点吸附到前一个关键帧，否则解码器拿不到参考帧，画面会花
    const startPacket = (await videoSink.getKeyPacket(start)) ?? (await videoSink.getFirstKeyPacket());
    if (!startPacket) throw new Error('视频轨没有可用的关键帧');
    const actualStart = startPacket.timestamp;
    const span = Math.max(end - actualStart, Number.EPSILON);

    const videoDecoderConfig = await videoTrack.getDecoderConfig();
    let firstVideoPacket = true;
    for await (const packet of videoSink.packets(startPacket)) {
      throwIfAborted();
      if (packet.timestamp >= end) break;
      await videoSource.add(
        packet.clone({ timestamp: packet.timestamp - actualStart }),
        firstVideoPacket && videoDecoderConfig ? { decoderConfig: videoDecoderConfig } : undefined,
      );
      firstVideoPacket = false;
      onProgress?.(Math.min(1, (packet.timestamp - actualStart) / span));
    }
    videoSource.close();

    if (audioTrack && audioSource) {
      const audioSink = new EncodedPacketSink(audioTrack);
      const audioStart = (await audioSink.getPacket(actualStart)) ?? undefined;
      const audioDecoderConfig = await audioTrack.getDecoderConfig();
      let firstAudioPacket = true;
      for await (const packet of audioSink.packets(audioStart)) {
        throwIfAborted();
        if (packet.timestamp >= end) break;
        // 音频分组可能早于视频入点，平移后为负会被容器拒绝
        const shifted = packet.timestamp - actualStart;
        if (shifted < 0) continue;
        await audioSource.add(
          packet.clone({ timestamp: shifted }),
          firstAudioPacket && audioDecoderConfig
            ? { decoderConfig: audioDecoderConfig }
            : undefined,
        );
        firstAudioPacket = false;
      }
      audioSource.close();
    }

    await output.finalize();
    onProgress?.(1);

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('导出未产生有效数据');
    return { bytes: new Uint8Array(buffer), actualStart };
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
}

/**
 * 合成导出 —— 多轨叠加 / 画中画 / 转场 / 混音都走这条路。
 *
 * 与无损直通互斥：这里逐帧渲染并重编码，因此支持任意合成，
 * 代价是慢且有一次编码损失。调用方应先用 `needsCompositing()` 判断，
 * 能直通就别进来。
 */
export async function exportComposite(options: {
  tracks: VideoEditorTrack[];
  duration: number;
  canvas: VideoEditorCanvasSize;
  frameRate: number;
  resolveVideo: ClipSourceResolver;
  resolveAudio: ClipAudioResolver;
  onProgress?: (progress: number) => void;
  onStage?: (stage: string) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const {
    tracks, duration, canvas, frameRate,
    resolveVideo, resolveAudio, onProgress, onStage, signal,
  } = options;
  if (duration <= 0) throw new Error('时间轴为空，没有可导出的内容');

  guardEncoderProbe();

  const surface = document.createElement('canvas');
  surface.width = canvas.width;
  surface.height = canvas.height;
  const context = surface.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建合成画布');

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(surface, {
    codec: 'avc',
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(videoSource);

  // 音频先混好再决定要不要加轨：没有可用音频就别给输出留空轨
  onStage?.('混合音频');
  const mixed = await mixTimelineAudio({
    tracks,
    duration,
    resolve: resolveAudio,
    signal,
    onProgress: (value) => onProgress?.(value * 0.2),
  });

  const audioSource = mixed
    ? new AudioBufferSource({ codec: 'aac', bitrate: QUALITY_MEDIUM })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  try {
    onStage?.('渲染画面');
    const frameCount = Math.max(1, Math.round(duration * frameRate));
    const frameDuration = 1 / frameRate;

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (signal?.aborted) throw new VideoExportCanceledError();
      const time = frame * frameDuration;
      await renderFrameAt(context, canvas, tracks, time, resolveVideo);
      await videoSource.add(time, frameDuration);
      // 画面占 20%–90% 的进度区间，音频写入留在最后
      onProgress?.(0.2 + (frame / frameCount) * 0.7);
    }
    videoSource.close();

    if (audioSource && mixed) {
      onStage?.('写入音频');
      const buffers = toAudioBuffers(mixed);
      for (const [index, buffer] of buffers.entries()) {
        if (signal?.aborted) throw new VideoExportCanceledError();
        await audioSource.add(buffer);
        onProgress?.(0.9 + (index / buffers.length) * 0.1);
      }
      audioSource.close();
    }

    await output.finalize();
    onProgress?.(1);

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('导出未产生有效数据');
    return new Uint8Array(buffer);
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
}

/** 拼接导出的输入片段 */
export type ConcatSegment = {
  input: Input;
  start: number;
  end: number;
  label: string;
};

/**
 * 多片段关键帧对齐的无损拼接导出。
 *
 * 直通复制的前提是所有片段共用同一套解码参数，因此这里要求编码与分辨率一致；
 * 不一致时明确报错，而不是产出一个播不动的文件。
 */
export async function exportLosslessConcat(options: {
  segments: ConcatSegment[];
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<LosslessTrimResult> {
  const { segments, onProgress, signal } = options;
  if (segments.length === 0) throw new Error('没有可导出的片段');
  if (segments.length === 1) {
    return exportLosslessTrim({ ...segments[0], onProgress, signal });
  }

  // 先统一校验，避免写了一半才发现拼不起来
  const tracks = await Promise.all(segments.map(async (segment) => {
    const track = await segment.input.getPrimaryVideoTrack();
    if (!track) throw new Error(`片段「${segment.label}」没有视频轨`);
    return { segment, track, codec: await track.getCodec() };
  }));

  const [first, ...rest] = tracks;
  if (!first.codec) throw new Error('无法识别源视频编码，无法直通拼接');
  const mismatch = rest.find((entry) => entry.codec !== first.codec
    || entry.track.displayWidth !== first.track.displayWidth
    || entry.track.displayHeight !== first.track.displayHeight);
  if (mismatch) {
    throw new Error(
      `片段「${mismatch.segment.label}」的编码或分辨率与首个片段不一致，无法直通拼接`
      + `（${mismatch.codec ?? '未知'} ${mismatch.track.displayWidth}×${mismatch.track.displayHeight}`
      + ` vs ${first.codec} ${first.track.displayWidth}×${first.track.displayHeight}）`,
    );
  }

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  if (!output.format.getSupportedVideoCodecs().includes(first.codec)) {
    throw new Error(`MP4 容器不支持源编码 ${first.codec}`);
  }

  const videoSource = new EncodedVideoPacketSource(first.codec);
  output.addVideoTrack(videoSource, { rotation: first.track.rotation });
  await output.start();

  try {
    const totalSpan = tracks.reduce(
      (sum, entry) => sum + Math.max(0, entry.segment.end - entry.segment.start),
      0,
    );
    let timelineCursor = 0;
    let firstPacket = true;
    let actualStart = 0;

    for (const [index, entry] of tracks.entries()) {
      if (signal?.aborted) throw new VideoExportCanceledError();

      const sink = new EncodedPacketSink(entry.track);
      const startPacket = (await sink.getKeyPacket(entry.segment.start))
        ?? (await sink.getFirstKeyPacket());
      if (!startPacket) throw new Error(`片段「${entry.segment.label}」没有可用的关键帧`);
      if (index === 0) actualStart = startPacket.timestamp;

      const decoderConfig = await entry.track.getDecoderConfig();
      const segmentBase = startPacket.timestamp;

      for await (const packet of sink.packets(startPacket)) {
        if (signal?.aborted) throw new VideoExportCanceledError();
        if (packet.timestamp >= entry.segment.end) break;
        await videoSource.add(
          packet.clone({ timestamp: timelineCursor + (packet.timestamp - segmentBase) }),
          firstPacket && decoderConfig ? { decoderConfig } : undefined,
        );
        firstPacket = false;
        if (totalSpan > 0) {
          const done = timelineCursor + (packet.timestamp - segmentBase);
          onProgress?.(Math.min(1, done / totalSpan));
        }
      }
      timelineCursor += Math.max(0, entry.segment.end - segmentBase);
    }

    videoSource.close();
    await output.finalize();
    onProgress?.(1);

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('导出未产生有效数据');
    return { bytes: new Uint8Array(buffer), actualStart };
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
}

/**
 * 重编码导出（回退路径）。
 *
 * 入点不为 0 时 mediabunny 必然重编码，依赖 VideoEncoder；
 * 只有在无损直通不可用（源编码进不了 MP4）时才该走这里。
 */
export async function exportTrimmedVideo(options: {
  input: Input;
  start: number;
  end: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const { input, start, end, onProgress, signal } = options;
  if (!(end > start)) throw new Error('导出区间无效：出点必须大于入点');

  guardEncoderProbe();
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, trim: { start, end } });

  if (!conversion.isValid) {
    const reasons = [...new Set(
      conversion.discardedTracks.map((track) => DISCARD_REASON_TEXT[track.reason] ?? track.reason),
    )].join('、');
    throw new Error(`当前视频无法导出${reasons ? `：${reasons}` : ''}`);
  }

  if (onProgress) conversion.onProgress = (progress) => onProgress(progress);

  const onAbort = () => { void conversion.cancel(); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await conversion.execute();
  } catch (error) {
    if (signal?.aborted) throw new VideoExportCanceledError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('导出未产生有效数据');
  return new Uint8Array(buffer);
}

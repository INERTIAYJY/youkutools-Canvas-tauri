/**
 * WebCodecs 能力自检 —— 报告本机 WebView 真正能做什么。
 *
 * 独立窗口开不了 devtools，而「能不能编码」直接决定转场/合成/音轨这些
 * 路线是否成立，因此用实测代替推断：不仅问 `isConfigSupported`，
 * 还真的配置一次编码器并编一帧，因为前者在部分 WebView 上并不可靠。
 */

export interface CodecProbeResult {
  label: string;
  codec: string;
  width: number;
  height: number;
  /** isConfigSupported 的回答；throw 表示它自己抛了异常 */
  declared: 'supported' | 'unsupported' | 'throw';
  /** 真正 configure + 编一帧的结果，这才是可信答案 */
  actual: 'ok' | 'failed';
  detail?: string;
}

export interface CodecProbeReport {
  hasVideoEncoder: boolean;
  hasVideoDecoder: boolean;
  /** WebKit 至今未实现 AudioEncoder，直接决定合成导出能否混流 */
  hasAudioEncoder: boolean;
  hasAudioDecoder: boolean;
  results: CodecProbeResult[];
}

/** 覆盖常用编码与档位；4K 单列，用来验证是否只是分辨率上限问题 */
const PROBES: { label: string; codec: string; width: number; height: number }[] = [
  { label: 'H.264 720p', codec: 'avc1.42001f', width: 1280, height: 720 },
  { label: 'H.264 1080p', codec: 'avc1.4d0028', width: 1920, height: 1080 },
  { label: 'H.264 4K', codec: 'avc1.640033', width: 3840, height: 2160 },
  { label: 'HEVC 1080p', codec: 'hvc1.1.6.L93.B0', width: 1920, height: 1080 },
  { label: 'VP9 1080p', codec: 'vp09.00.10.08', width: 1920, height: 1080 },
  { label: 'AV1 1080p', codec: 'av01.0.08M.08', width: 1920, height: 1080 },
];

async function probeOne(
  probe: { label: string; codec: string; width: number; height: number },
): Promise<CodecProbeResult> {
  const config: VideoEncoderConfig = {
    codec: probe.codec,
    width: probe.width,
    height: probe.height,
    bitrate: 2_000_000,
    framerate: 30,
  };

  let declared: CodecProbeResult['declared'];
  let detail: string | undefined;
  try {
    const support = await VideoEncoder.isConfigSupported(config);
    declared = support.supported ? 'supported' : 'unsupported';
  } catch (error) {
    declared = 'throw';
    detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  // isConfigSupported 说不行也照样实测一次：它在部分 WebView 上并不可信
  const actual = await new Promise<CodecProbeResult['actual']>((resolve) => {
    let settled = false;
    const finish = (value: CodecProbeResult['actual'], reason?: string) => {
      if (settled) return;
      settled = true;
      if (reason && !detail) detail = reason;
      resolve(value);
    };

    try {
      const encoder = new VideoEncoder({
        output: () => finish('ok'),
        error: (error) => finish('failed', error.message),
      });
      encoder.configure(config);
      const frame = new VideoFrame(new Uint8Array(probe.width * probe.height * 4), {
        format: 'RGBA',
        codedWidth: probe.width,
        codedHeight: probe.height,
        timestamp: 0,
      });
      encoder.encode(frame, { keyFrame: true });
      frame.close();
      void encoder.flush()
        .then(() => finish('ok'))
        .catch((error: unknown) => finish(
          'failed',
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        ))
        .finally(() => { try { encoder.close(); } catch { /* already closed */ } });
    } catch (error) {
      finish('failed', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
  });

  return { ...probe, declared, actual, detail };
}

export async function probeVideoCodecs(): Promise<CodecProbeReport> {
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasVideoDecoder = typeof VideoDecoder !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined';
  const hasAudioDecoder = typeof AudioDecoder !== 'undefined';
  const base = { hasVideoEncoder, hasVideoDecoder, hasAudioEncoder, hasAudioDecoder };
  if (!hasVideoEncoder) return { ...base, results: [] };

  const results: CodecProbeResult[] = [];
  for (const probe of PROBES) {
    results.push(await probeOne(probe));
  }
  return { ...base, results };
}

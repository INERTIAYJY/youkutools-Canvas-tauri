/**
 * 合成渲染 —— 把某一时刻所有可见轨道画到一张画布上。
 *
 * 这是多轨叠加、画中川、转场三件事共用的底座：预览与导出走同一条渲染路径，
 * 所见即所得。视频帧由 mediabunny 的 VideoSampleSink 解出，
 * 图片片段直接用已加载的 ImageBitmap。
 */
import { VideoSampleSink, type Input, type VideoSample } from 'mediabunny';
import {
  DEFAULT_TRANSFORM,
  evaluateTransitionAlpha,
  getActiveClips,
  type VideoEditorCanvasSize,
  type VideoEditorClip,
  type VideoEditorTrack,
  type VideoEditorTransform,
} from '../types/videoEditor';

/** 一个片段的渲染素材：视频给 sink，图片给位图 */
export interface ClipRenderSource {
  sink?: VideoSampleSink;
  bitmap?: ImageBitmap;
  /** 素材原始尺寸，用于按比例摆放 */
  width: number;
  height: number;
}

export type ClipSourceResolver = (clip: VideoEditorClip) => ClipRenderSource | undefined;

/** 为一批片段准备渲染素材；调用方负责 dispose 传入的 Input */
export async function createClipRenderSource(
  input: Input,
): Promise<ClipRenderSource | undefined> {
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) return undefined;
  return {
    sink: new VideoSampleSink(track),
    width: track.displayWidth,
    height: track.displayHeight,
  };
}

/**
 * 计算片段在画布上的绘制矩形。
 *
 * scale=1 表示按 contain 铺满画布；叠加层用更小的 scale 做画中画。
 */
export function computeDrawRect(
  source: { width: number; height: number },
  canvas: VideoEditorCanvasSize,
  transform: VideoEditorTransform,
): { x: number; y: number; width: number; height: number } {
  const containScale = Math.min(
    canvas.width / Math.max(1, source.width),
    canvas.height / Math.max(1, source.height),
  );
  const width = source.width * containScale * transform.scale;
  const height = source.height * containScale * transform.scale;
  return {
    x: transform.x * canvas.width - width / 2,
    y: transform.y * canvas.height - height / 2,
    width,
    height,
  };
}

function drawOne(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: { width: number; height: number },
  canvas: VideoEditorCanvasSize,
  transform: VideoEditorTransform,
  alpha: number,
) {
  const rect = computeDrawRect(source, canvas, transform);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, transform.opacity * alpha));
  if (transform.rotation !== 0) {
    context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.rotate((transform.rotation * Math.PI) / 180);
    context.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
  } else {
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  }
  context.restore();
}

/**
 * 渲染某一时刻的一帧。
 *
 * 轨道按数组顺序自下而上叠加；隐藏轨跳过。
 * 转场用不透明度实现：dissolve 让新片段淡入压在旧片段之上，fade 则先铺黑底。
 */
export async function renderFrameAt(
  context: CanvasRenderingContext2D,
  canvas: VideoEditorCanvasSize,
  tracks: VideoEditorTrack[],
  time: number,
  resolve: ClipSourceResolver,
): Promise<void> {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const samplesToClose: VideoSample[] = [];
  try {
    for (const track of tracks) {
      if (track.hidden || track.kind !== 'video') continue;

      for (const clip of getActiveClips(track, time)) {
        const source = resolve(clip);
        if (!source) continue;

        const timeInClip = time - clip.timelineStart;
        const transform = clip.transform ?? DEFAULT_TRANSFORM;
        const alpha = evaluateTransitionAlpha(clip, timeInClip);

        if (clip.transitionIn?.kind === 'fade' && alpha < 1) {
          // 从黑场淡入：底色已是黑，直接用 alpha 控制即可
          context.save();
          context.globalAlpha = 1 - alpha;
          context.fillStyle = '#000';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.restore();
        }

        if (source.bitmap) {
          drawOne(context, source.bitmap, source, canvas, transform, alpha);
          continue;
        }
        if (!source.sink) continue;

        const sample = await source.sink.getSample(clip.sourceIn + timeInClip);
        if (!sample) continue;
        samplesToClose.push(sample);
        drawOne(
          context,
          sample.toCanvasImageSource() as CanvasImageSource,
          source,
          canvas,
          transform,
          alpha,
        );
      }
    }
  } finally {
    for (const sample of samplesToClose) sample.close();
  }
}

/**
 * 合成渲染 —— 把某一时刻所有可见轨道画到一张画布上。
 *
 * 这是多轨叠加、画中川、转场三件事共用的底座：预览与导出走同一条渲染路径，
 * 所见即所得。视频帧由 mediabunny 的 VideoSampleSink 解出，
 * 图片片段直接用已加载的 ImageBitmap。
 */
import { VideoSampleSink, type Input, type VideoSample } from 'mediabunny';
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  evaluateTransitionAlpha,
  getActiveClips,
  getClipEnd,
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

/** 文字片段直接在输出画布绘制，避免先生成临时位图造成清晰度损失。 */
function drawTextClip(
  context: CanvasRenderingContext2D,
  canvas: VideoEditorCanvasSize,
  clip: VideoEditorClip,
  alpha: number,
) {
  const transform = clip.transform ?? DEFAULT_TRANSFORM;
  const textStyle = { ...DEFAULT_TEXT_STYLE, ...clip.textStyle };
  const lines = (textStyle.content.trim() || DEFAULT_TEXT_STYLE.content).split(/\r?\n/);
  const fontSize = Math.max(8, textStyle.fontSize * transform.scale);
  const lineHeight = fontSize * 1.2;

  context.save();
  context.translate(transform.x * canvas.width, transform.y * canvas.height);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.globalAlpha = Math.max(0, Math.min(1, transform.opacity * alpha));
  context.fillStyle = textStyle.color;
  context.font = `${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`;
  context.textAlign = textStyle.align;
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = Math.max(2, fontSize * 0.08);
  const firstLineY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, 0, firstLineY + index * lineHeight));
  context.restore();
}

/**
 * 画一个片段在指定素材时刻的画面。
 *
 * sourceTime 是素材坐标而非时间轴坐标：交叠淡入要把已经结束的前一段
 * 按它出点之后的素材继续画出来，那个时刻落在片段的取用区间之外。
 */
async function drawClipAt(
  context: CanvasRenderingContext2D,
  canvas: VideoEditorCanvasSize,
  clip: VideoEditorClip,
  sourceTime: number,
  alpha: number,
  resolve: ClipSourceResolver,
  samplesToClose: VideoSample[],
): Promise<void> {
  if (clip.kind === 'text') {
    drawTextClip(context, canvas, clip, alpha);
    return;
  }

  const source = resolve(clip);
  if (!source) return;
  const transform = clip.transform ?? DEFAULT_TRANSFORM;

  if (source.bitmap) {
    drawOne(context, source.bitmap, source, canvas, transform, alpha);
    return;
  }
  if (!source.sink) return;

  const sample = await source.sink.getSample(Math.max(0, sourceTime));
  if (!sample) return;
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

/**
 * 找出可以作为交叠淡入底画面的前一段。
 *
 * 只认首尾严丝合缝相接的那一段：叠加轨允许留空和自由摆放，
 * 隔着一段距离的「上一个片段」不构成交叠关系。
 */
function findDissolveUnderlay(
  track: VideoEditorTrack,
  clip: VideoEditorClip,
): VideoEditorClip | undefined {
  const index = track.clips.indexOf(clip);
  if (index <= 0) return undefined;
  const previous = track.clips[index - 1];
  return Math.abs(getClipEnd(previous) - clip.timelineStart) < 0.001 ? previous : undefined;
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
        const timeInClip = time - clip.timelineStart;
        const alpha = evaluateTransitionAlpha(clip, timeInClip);

        if (alpha < 1 && clip.transitionIn?.kind === 'dissolve') {
          // 片段在时间轴上首尾相接，转场窗口内前一段其实已经结束了。
          // 不把它出点之后的素材继续画出来当底，交叠淡入就退化成从黑底淡入，
          // 和 fade 一模一样。素材没有余量时自然回落到黑底。
          const underlay = findDissolveUnderlay(track, clip);
          if (underlay) {
            await drawClipAt(
              context,
              canvas,
              underlay,
              underlay.sourceOut + timeInClip,
              1,
              resolve,
              samplesToClose,
            );
          }
        }

        if (clip.transitionIn?.kind === 'fade' && alpha < 1) {
          // 从黑场淡入：底色已是黑，直接用 alpha 控制即可
          context.save();
          context.globalAlpha = 1 - alpha;
          context.fillStyle = '#000';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.restore();
        }

        await drawClipAt(
          context,
          canvas,
          clip,
          clip.sourceIn + timeInClip,
          alpha,
          resolve,
          samplesToClose,
        );
      }
    }
  } finally {
    for (const sample of samplesToClose) sample.close();
  }
}

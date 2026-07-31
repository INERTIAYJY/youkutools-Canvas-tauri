/**
 * 吉祥物的动作曲线与调度取值。
 *
 * 这些是纯函数，与 Three.js 渲染循环解耦：渲染循环只负责按帧把结果写进
 * 场景对象，曲线本身可以单独验证，不需要 WebGL 环境。
 */

/** 状态转场时的一次性肢体反应。 */
export type MascotReactionKind = 'hop' | 'shake';

/** 各反应的时长（秒）。 */
export const REACTION_DURATIONS: Record<MascotReactionKind, number> = {
  hop: 0.62,
  shake: 0.5,
};

const HOP_HEIGHT = 0.16;
const HOP_SQUASH = 0.14;
/** 起跳前的下蹲与落地压扁各占的进度比例。 */
const HOP_CROUCH_END = 0.18;
const HOP_LAND_START = 0.82;
const SHAKE_ANGLE = 0.2;
const SHAKE_CYCLES = 2.5;
const SHAKE_DIP = 0.05;

export interface MascotReactionPose {
  /** 竖直位移，正值向上。 */
  lift: number;
  /** 叠加到头部偏航上的角度（弧度）。 */
  yaw: number;
  /** 纵向缩放系数，1 为原始高度；横向由调用方按等体积换算。 */
  squashY: number;
}

const NEUTRAL_POSE: MascotReactionPose = { lift: 0, yaw: 0, squashY: 1 };

/** 蹦跳的挤压拉伸：起跳前下蹲、空中拉长、落地再压一下。 */
function getHopSquash(progress: number): number {
  if (progress < HOP_CROUCH_END) {
    return 1 - HOP_SQUASH * Math.sin((progress / HOP_CROUCH_END) * Math.PI);
  }
  if (progress > HOP_LAND_START) {
    return 1 - HOP_SQUASH * Math.sin(((progress - HOP_LAND_START) / (1 - HOP_LAND_START)) * Math.PI);
  }
  const airProgress = (progress - HOP_CROUCH_END) / (HOP_LAND_START - HOP_CROUCH_END);
  return 1 + HOP_SQUASH * 0.6 * Math.sin(airProgress * Math.PI);
}

/**
 * 按反应进度取当前姿态。progress 会被夹到 [0,1]，两端都回到中立姿态，
 * 这样反应结束时不会在场景里留下残余位移或旋转。
 */
export function getReactionPose(kind: MascotReactionKind, progress: number): MascotReactionPose {
  const clamped = Math.min(Math.max(progress, 0), 1);
  if (clamped >= 1) return NEUTRAL_POSE;

  if (kind === 'hop') {
    return {
      lift: Math.sin(Math.PI * clamped) * HOP_HEIGHT,
      yaw: 0,
      squashY: getHopSquash(clamped),
    };
  }
  // 摇头：左右摆动并随进度衰减，同时轻微下沉，读起来像“不行”。
  return {
    lift: -Math.sin(Math.PI * clamped) * SHAKE_DIP,
    yaw: Math.sin(clamped * Math.PI * 2 * SHAKE_CYCLES) * SHAKE_ANGLE * (1 - clamped),
    squashY: 1,
  };
}

/** 等体积换算：纵向压扁多少，横向就相应变宽。 */
export function getSquashWidth(squashY: number): number {
  return 1 / Math.sqrt(Math.max(squashY, 0.05));
}

/** 取下一个张望落点，保证与当前落点不同，避免连续两次看向同一处。 */
export function pickNextGazeIndex(
  currentIndex: number,
  pointCount: number,
  random: number,
): number {
  if (pointCount <= 1) return 0;
  const candidate = Math.min(Math.floor(random * pointCount), pointCount - 1);
  return candidate === currentIndex ? (candidate + 1) % pointCount : candidate;
}

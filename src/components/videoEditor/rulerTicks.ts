/**
 * 刻度尺的步长与标签计算 —— 与渲染分开，便于单测。
 */

/** 主刻度候选步长（秒），按「1/2/5」级差覆盖从零点几秒到十分钟 */
const STEP_CANDIDATES = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
];

/** 目标是让主刻度大约 8 条，太密会糊成一片 */
const TARGET_MAJOR_TICKS = 8;

/** 主刻度之间至少要留出的像素，低于这个值标签会互相压住 */
const MIN_MAJOR_TICK_PX = 72;

/**
 * 选取主刻度步长。
 *
 * 给了 `pixelsPerSecond` 就按像素密度决定（缩放后自动细分到更小单位），
 * 没给则退回按总时长切成约 8 段。
 */
export function pickTickStep(duration: number, pixelsPerSecond?: number): number {
  if (duration <= 0) return 1;

  const ideal = pixelsPerSecond && pixelsPerSecond > 0
    ? MIN_MAJOR_TICK_PX / pixelsPerSecond
    : duration / TARGET_MAJOR_TICKS;

  return STEP_CANDIDATES.find((candidate) => candidate >= ideal)
    ?? STEP_CANDIDATES[STEP_CANDIDATES.length - 1];
}

/** 刻度标签：超过一分钟才显示分段，短片直接读秒 */
export function formatTickLabel(time: number, step: number): string {
  if (time >= 60) {
    const minutes = Math.floor(time / 60);
    const seconds = time - minutes * 60;
    return `${minutes}:${seconds.toFixed(0).padStart(2, '0')}`;
  }
  // 步长不足 1 秒时保留一位小数，否则相邻标签会重复
  return step < 1 ? time.toFixed(1) : String(Math.round(time));
}

export interface RulerTick {
  time: number;
  major: boolean;
}

/** 生成刻度点：副刻度取主刻度的五分之一 */
export function buildTicks(duration: number, step: number): RulerTick[] {
  if (duration <= 0 || step <= 0) return [];
  const ticks: RulerTick[] = [];
  const minorStep = step / 5;
  for (let index = 0; index * minorStep <= duration + 1e-6; index += 1) {
    const time = index * minorStep;
    const major = Math.abs(time / step - Math.round(time / step)) < 1e-6;
    ticks.push({ time, major });
  }
  return ticks;
}

/**
 * composerRange — 滑杆轨道的填充区间
 *
 * 轨道用 CSS 渐变画出「已填充」段，区间由这里算出的两个 CSS 变量决定。
 */
import type { CSSProperties } from 'react';

/**
 * 单极滑杆（min ≥ 0）从左端起算；双极滑杆（min < 0 < max）从中点起算，
 * 这样「0 = 不调整」在视觉上就是一条居中的分界。
 */
export function rangeFill(value: number, min: number, max: number): CSSProperties {
  const span = max - min;
  if (span <= 0) return {};
  const pct = ((value - min) / span) * 100;
  const origin = min < 0 && max > 0 ? ((0 - min) / span) * 100 : 0;
  return {
    '--range-from': `${Math.min(origin, pct)}%`,
    '--range-to': `${Math.max(origin, pct)}%`,
  } as CSSProperties;
}

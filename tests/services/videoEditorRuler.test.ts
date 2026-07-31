import { describe, expect, it } from 'vitest';

import {
  buildTicks,
  formatTickLabel,
  pickTickStep,
} from '../../src/components/videoEditor/rulerTicks';

describe('pickTickStep', () => {
  it('keeps the major tick count near the target across scales', () => {
    for (const duration of [3, 16, 45, 120, 600, 3600]) {
      const step = pickTickStep(duration);
      const majorCount = Math.floor(duration / step);
      // 目标 8 条，允许在候选步长的粒度内浮动
      expect(majorCount).toBeGreaterThanOrEqual(1);
      expect(majorCount).toBeLessThanOrEqual(16);
    }
  });

  it('subdivides as the zoom grows, so labels never collide', () => {
    // 给了像素密度就按它决定：放得越大，步长越细
    const coarse = pickTickStep(60, 5);
    const fine = pickTickStep(60, 200);
    expect(fine).toBeLessThan(coarse);
  });

  it('keeps major ticks at least ~72px apart at any zoom', () => {
    for (const pps of [4, 12, 40, 120, 400]) {
      const step = pickTickStep(60, pps);
      expect(step * pps).toBeGreaterThanOrEqual(72 - 1e-6);
    }
  });

  it('picks sub-second steps for very short clips', () => {
    expect(pickTickStep(1)).toBeLessThan(1);
  });

  it('falls back to a sane step for a zero-length timeline', () => {
    expect(pickTickStep(0)).toBe(1);
    expect(pickTickStep(-5)).toBe(1);
  });
});

describe('formatTickLabel', () => {
  it('reads plain seconds below a minute', () => {
    expect(formatTickLabel(5, 5)).toBe('5');
    expect(formatTickLabel(30, 10)).toBe('30');
  });

  it('keeps one decimal when the step is sub-second', () => {
    // 否则 0.5 与 1.0 会同时显示成 "1"
    expect(formatTickLabel(0.5, 0.5)).toBe('0.5');
    expect(formatTickLabel(1.5, 0.5)).toBe('1.5');
  });

  it('switches to m:ss past a minute', () => {
    expect(formatTickLabel(60, 30)).toBe('1:00');
    expect(formatTickLabel(95, 30)).toBe('1:35');
    expect(formatTickLabel(600, 60)).toBe('10:00');
  });
});

describe('buildTicks', () => {
  it('marks every fifth tick as major', () => {
    const ticks = buildTicks(10, 5);
    expect(ticks[0]).toEqual({ time: 0, major: true });
    expect(ticks[1].major).toBe(false);
    expect(ticks[5]).toEqual({ time: 5, major: true });
  });

  it('never runs past the timeline end', () => {
    const ticks = buildTicks(16.4, 2);
    expect(ticks[ticks.length - 1].time).toBeLessThanOrEqual(16.4 + 1e-6);
  });

  it('returns nothing for an empty timeline', () => {
    expect(buildTicks(0, 1)).toEqual([]);
    expect(buildTicks(10, 0)).toEqual([]);
  });
});

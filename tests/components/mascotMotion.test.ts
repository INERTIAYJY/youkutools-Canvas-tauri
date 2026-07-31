import { describe, expect, it } from 'vitest';
import {
  REACTION_DURATIONS,
  getReactionPose,
  getSquashWidth,
  pickNextGazeIndex,
} from '../../src/components/shared/mascot/mascotMotion';

describe('mascotMotion', () => {
  it('starts and ends every reaction at the neutral pose', () => {
    for (const kind of ['hop', 'shake'] as const) {
      for (const progress of [0, 1, 1.5]) {
        const pose = getReactionPose(kind, progress);
        // 反应两端必须回到中立姿态，否则结束后场景里会留下残余位移或旋转
        expect(pose.lift).toBeCloseTo(0, 6);
        expect(pose.yaw).toBeCloseTo(0, 6);
        expect(pose.squashY).toBeCloseTo(1, 6);
      }
    }
  });

  it('lifts the body and stretches it mid-air during a hop', () => {
    const peak = getReactionPose('hop', 0.5);
    expect(peak.lift).toBeGreaterThan(0.1);
    expect(peak.squashY).toBeGreaterThan(1);
    expect(peak.yaw).toBe(0);

    // 起跳前下蹲、落地压扁：两端都比原始高度矮
    expect(getReactionPose('hop', 0.09).squashY).toBeLessThan(1);
    expect(getReactionPose('hop', 0.91).squashY).toBeLessThan(1);
  });

  it('swings the head both ways and decays over a shake', () => {
    const samples = Array.from({ length: 40 }, (_, index) => getReactionPose('shake', index / 40).yaw);
    expect(Math.max(...samples)).toBeGreaterThan(0.05);
    expect(Math.min(...samples)).toBeLessThan(-0.05);

    // 摆幅随进度衰减：后段的最大绝对值必须小于前段
    const earlyPeak = Math.max(...samples.slice(0, 10).map(Math.abs));
    const latePeak = Math.max(...samples.slice(30).map(Math.abs));
    expect(latePeak).toBeLessThan(earlyPeak);

    // 摇头不该把身体抬起来
    expect(getReactionPose('shake', 0.5).lift).toBeLessThan(0);
  });

  it('keeps the reaction durations positive and short enough to read as one beat', () => {
    expect(REACTION_DURATIONS.hop).toBeGreaterThan(0);
    expect(REACTION_DURATIONS.shake).toBeGreaterThan(0);
    expect(REACTION_DURATIONS.hop).toBeLessThan(1.2);
    expect(REACTION_DURATIONS.shake).toBeLessThan(1.2);
  });

  it('widens the body when it is squashed and narrows it when stretched', () => {
    expect(getSquashWidth(1)).toBeCloseTo(1, 6);
    expect(getSquashWidth(0.86)).toBeGreaterThan(1);
    expect(getSquashWidth(1.09)).toBeLessThan(1);
    // 极端值不能算出无穷或负数缩放
    expect(Number.isFinite(getSquashWidth(0))).toBe(true);
    expect(getSquashWidth(0)).toBeGreaterThan(0);
  });

  it('never picks the gaze point it is already looking at', () => {
    for (let current = 0; current < 5; current += 1) {
      for (const random of [0, 0.19, 0.4, 0.61, 0.83, 0.999]) {
        const next = pickNextGazeIndex(current, 5, random);
        expect(next).not.toBe(current);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(5);
      }
    }
  });

  it('stays in range when random returns exactly 1 or there is a single point', () => {
    expect(pickNextGazeIndex(-1, 6, 1)).toBe(5);
    expect(pickNextGazeIndex(0, 1, 0.5)).toBe(0);
  });
});

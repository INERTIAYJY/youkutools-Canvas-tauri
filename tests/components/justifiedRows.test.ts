import { describe, expect, it } from 'vitest';
import { justifiedRows } from '../../src/components/character/justifiedRows';

const GAP = 8;

/** 按排版结果反算每个格子的宽高比，应与图片自身一致（不裁切） */
function cellRatios(ratios: number[], width: number, height: number) {
  const layout = justifiedRows(ratios, width, height, GAP)!;
  return layout.rows.flatMap((row) => {
    const inner = layout.width - GAP * (row.items.length - 1);
    const sum = row.items.reduce((total, index) => total + ratios[index], 0);
    return row.items.map((index) => (inner * ratios[index]) / sum / row.height);
  });
}

describe('justifiedRows', () => {
  it('每个格子的宽高比等于图片宽高比', () => {
    const ratios = [0.6, 1.5, 1, 0.8, 2.2];
    for (const ratio of cellRatios(ratios, 1074, 455)) {
      expect(ratios).toContainEqual(expect.closeTo(ratio, 6));
    }
  });

  it('排版不超出容器', () => {
    for (const ratios of [[0.4], [1.6], [0.6, 1.5, 1], [1, 1, 1, 1, 1, 1, 1]]) {
      const layout = justifiedRows(ratios, 1074, 455, GAP)!;
      const total = layout.rows.reduce((sum, row) => sum + row.height, 0)
        + GAP * (layout.rows.length - 1);
      expect(total).toBeLessThanOrEqual(455 + 0.01);
      expect(layout.width).toBeLessThanOrEqual(1074 + 0.01);
    }
  });

  it('每张图都排进去且只排一次', () => {
    const ratios = [0.6, 1.5, 1, 0.8, 2.2, 1.1];
    const placed = justifiedRows(ratios, 900, 600, GAP)!.rows.flatMap((row) => row.items);
    expect([...placed].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('横图排满整宽，不留横向空隙', () => {
    const layout = justifiedRows([1.6, 1.6, 1.6], 1074, 455, GAP)!;
    expect(layout.width).toBeCloseTo(1074, 6);
    expect(layout.rows).toHaveLength(1);
  });

  it('单张竖图放不下时等比缩小而不是裁切', () => {
    const layout = justifiedRows([0.4], 1074, 455, GAP)!;
    expect(layout.rows[0].height).toBeCloseTo(455, 6);
    expect(layout.width).toBeCloseTo(455 * 0.4, 6);
  });

  // 浮层要贴图片框而不是容器边缘，靠的就是 width/height 这对返回值
  it('height 等于各行高加行间距', () => {
    for (const ratios of [[0.4], [1.6], [0.6, 1.5, 1], [1, 1, 1, 1, 1, 1, 1]]) {
      const layout = justifiedRows(ratios, 1074, 455, GAP)!;
      const expected = layout.rows.reduce((sum, row) => sum + row.height, 0)
        + GAP * (layout.rows.length - 1);
      expect(layout.height).toBeCloseTo(expected, 6);
      expect(layout.height).toBeLessThanOrEqual(455 + 0.01);
    }
  });

  it('单张竖图缩小后 width/height 就是图片实际占的框', () => {
    const layout = justifiedRows([0.4], 1074, 455, GAP)!;
    expect(layout.height).toBeCloseTo(455, 6);
    expect(layout.width).toBeCloseTo(455 * 0.4, 6);
    // 容器宽 1074、图片只占 182，横向留白 892 —— 浮层若贴容器右边会整块脱离图片
    expect(1074 - layout.width).toBeGreaterThan(800);
  });

  it('空输入或零尺寸返回 null', () => {
    expect(justifiedRows([], 1074, 455, GAP)).toBeNull();
    expect(justifiedRows([1], 0, 455, GAP)).toBeNull();
  });
});

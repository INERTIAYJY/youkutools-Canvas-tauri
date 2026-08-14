/**
 * character/justifiedRows — 图片等宽排版（justified layout）。
 * 按图片宽高比顺序贪心分行，使每行宽高比之和尽量接近目标平均值，
 * 再等比缩放到容器宽度、垂直方向等距排布，用于角色参考图画廊的错落网格。
 */
export interface JustifiedRow {
  /** 该行图片在原数组中的下标 */
  items: number[];
  /** 行高（px） */
  height: number;
}

export interface JustifiedLayout {
  rows: JustifiedRow[];
  /** 行宽（px）；等于容器宽，或在图片过"竖"时等比缩小 */
  width: number;
  /** 所有行占据的总高（px，含行间距）；等比缩小后不超过容器高 */
  height: number;
}

/** 顺序贪心分行，每行的宽高比之和尽量接近平均值；行数不超过 rowCount，每行至少一张 */
function packRows(ratios: number[], rowCount: number): number[][] {
  const target = ratios.reduce((sum, ratio) => sum + ratio, 0) / rowCount;
  const rows: number[][] = [];
  let current: number[] = [];
  let sum = 0;
  ratios.forEach((ratio, index) => {
    current.push(index);
    sum += ratio;
    if (sum >= target && rows.length < rowCount - 1) {
      rows.push(current);
      current = [];
      sum = 0;
    }
  });
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * 按图片宽高比排版：行内按比例分配宽度铺满整行（不裁切、无横向留白），
 * 行数取总高最接近容器高度的那一种；整体仍高于容器时等比缩小并居中。
 *
 * @param ratios 每张图的 宽/高
 */
export function justifiedRows(
  ratios: number[],
  boxWidth: number,
  boxHeight: number,
  gap: number,
): JustifiedLayout | null {
  if (ratios.length === 0 || boxWidth <= 0 || boxHeight <= 0) return null;

  const measure = (rows: number[][]) => {
    const heights = rows.map((row) => {
      const inner = boxWidth - gap * (row.length - 1);
      return inner / row.reduce((sum, index) => sum + ratios[index], 0);
    });
    const total = heights.reduce((sum, height) => sum + height, 0) + gap * (rows.length - 1);
    return { heights, total };
  };

  let best: { rows: number[][]; heights: number[]; total: number } | null = null;
  for (let rowCount = 1; rowCount <= ratios.length; rowCount += 1) {
    const rows = packRows(ratios, rowCount);
    const { heights, total } = measure(rows);
    // 优先选不超出容器的最高方案；全都超出时退而求其次选最矮的
    const better = !best
      || (total <= boxHeight && (best.total > boxHeight || total > best.total))
      || (total > boxHeight && best.total > boxHeight && total < best.total);
    if (better) best = { rows, heights, total };
  }
  if (!best) return null;

  const gaps = gap * (best.rows.length - 1);
  const scale = best.total > boxHeight ? (boxHeight - gaps) / (best.total - gaps) : 1;
  const rows = best.rows.map((items, index) => ({ items, height: best.heights[index] * scale }));
  return {
    width: boxWidth * scale,
    height: rows.reduce((sum, row) => sum + row.height, 0) + gaps,
    rows,
  };
}

import { describe, expect, it } from 'vitest';
import { distributeToColumns } from '../../src/components/assets/waterfallColumns';

/** 从左到右、从上到下读一遍分列结果 */
function readingOrder<T>(columns: T[][]) {
  const rows = Math.max(...columns.map((column) => column.length));
  const order: T[] = [];
  for (let row = 0; row < rows; row += 1) {
    columns.forEach((column) => {
      if (row < column.length) order.push(column[row]);
    });
  }
  return order;
}

describe('distributeToColumns', () => {
  it('阅读顺序与原顺序一致（CSS columns 会打乱成 1,3,5,8,6,2,4,7）', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(readingOrder(distributeToColumns(items, 4))).toEqual(items);
  });

  it('首行就是前 N 项，所以首行卡片顶部必然齐平', () => {
    const columns = distributeToColumns([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(columns.map((column) => column[0])).toEqual([1, 2, 3, 4]);
  });

  it('列数固定，项目数少于列数时尾列为空而不是让卡片变宽', () => {
    const columns = distributeToColumns([1, 2, 3], 4);
    expect(columns).toHaveLength(4);
    expect(columns).toEqual([[1], [2], [3], []]);
  });

  it('每项只出现一次且各列长度最多差 1', () => {
    const items = Array.from({ length: 23 }, (_, index) => index);
    const columns = distributeToColumns(items, 5);
    expect(columns.flat().sort((a, b) => a - b)).toEqual(items);
    const lengths = columns.map((column) => column.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
  });

  it('分配只看下标，与图片高度无关，所以图片陆续加载完不会跳列', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(distributeToColumns(items, 3)).toEqual(distributeToColumns(items, 3));
    expect(distributeToColumns(items, 3)).toEqual([['a', 'd'], ['b', 'e'], ['c']]);
  });

  it('列数非法时退回单列而不是崩掉', () => {
    expect(distributeToColumns([1, 2], 0)).toEqual([[1, 2]]);
    expect(distributeToColumns([1, 2], -3)).toEqual([[1, 2]]);
  });

  it('空列表返回对应数量的空列', () => {
    expect(distributeToColumns([], 3)).toEqual([[], [], []]);
  });
});

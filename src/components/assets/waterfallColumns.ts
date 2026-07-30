/**
 * 把卡片按 DOM 顺序轮流分到各列：列内自上而下，整体读起来仍是从左到右。
 *
 * 不用 CSS 多列（columns: N）是因为它按"列高均衡"灌列——先把第 1 列填满再进第 2 列，
 * 视觉顺序会被打乱（8 张 4 列时读出来是 1,3,5,8,6,2,4,7），而且每张图加载完高度变化
 * 都会触发重新分配，卡片会跳列。轮流分配只看下标，顺序稳定，也保证首行卡片顶部对齐。
 */
export function distributeToColumns<T>(items: T[], columnCount: number): T[][] {
  const count = Math.max(1, Math.floor(columnCount));
  const columns: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, index) => {
    columns[index % count].push(item);
  });
  return columns;
}

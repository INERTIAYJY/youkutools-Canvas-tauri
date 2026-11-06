/**
 * 统一输出历史的类型与关键词筛选，供内存列表、数据库分页和导出复用。
 */
import type { HistoryQuery, OutputHistoryEntry } from '../types';

export function matchesHistoryQuery(
  record: Pick<OutputHistoryEntry, 'prompt' | 'output' | 'model' | 'nodeLabel'> & { nodeType: string },
  query: HistoryQuery,
): boolean {
  if (query.nodeType && record.nodeType !== query.nodeType) return false;
  const search = query.search?.trim().toLowerCase();
  if (!search) return true;
  return [record.prompt, record.output, record.model, record.nodeLabel]
    .some((value) => value.toLowerCase().includes(search));
}

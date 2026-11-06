/**
 * 串行准备参考媒体，保持输入顺序并在失败或取消时停止启动后续项。
 */
import { resolveImageUrlArray } from './imageUtils';

export async function mapSequentially<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
    results.push(await mapper(items[index], index));
  }
  return results;
}

export function resolveImageUrlsSequentially(
  urls: readonly string[],
  provider: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return mapSequentially(
    urls,
    async (url) => (await resolveImageUrlArray([url], provider, signal))[0],
    signal,
  );
}

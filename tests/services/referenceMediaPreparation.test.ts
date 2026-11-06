/**
 * 回归参考媒体串行准备的顺序、失败停止、取消传播及逐张图片解析边界。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveImageUrlArray } from '../../src/services/ai/imageUtils';
import { mapSequentially, resolveImageUrlsSequentially } from '../../src/services/ai/referenceMediaPreparation';

vi.mock('../../src/services/ai/imageUtils', () => ({ resolveImageUrlArray: vi.fn() }));

beforeEach(() => {
  vi.mocked(resolveImageUrlArray).mockReset();
});

describe('参考媒体串行准备', () => {
  it('前一项未完成时不启动后一项，保留重复输入、原下标及输出顺序', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started: Array<[string, number]> = [];
    const pending = mapSequentially(['A', 'B', 'A'] as const, async (value, index) => {
      started.push([value, index]);
      if (index === 0) await first;
      return `${index}:${value}`;
    });
    expect(started).toEqual([['A', 0]]);
    releaseFirst();
    await expect(pending).resolves.toEqual(['0:A', '1:B', '2:A']);
    expect(started).toEqual([['A', 0], ['B', 1], ['A', 2]]);
  });

  it('首个失败原样抛出，不再启动后续项或重试', async () => {
    const failure = new Error('参考素材读取失败');
    const prepare = vi.fn(async (value: string) => {
      if (value === 'bad') throw failure;
      return value;
    });
    await expect(mapSequentially(['A', 'bad', 'C'], prepare)).rejects.toBe(failure);
    expect(prepare.mock.calls.map(([value]) => value)).toEqual(['A', 'bad']);
  });

  it.each(['before', 'between'] as const)('%s 取消时透传原因，不启动剩余素材', async (phase) => {
    const controller = new AbortController();
    const reason = new Error('用户取消');
    const prepare = vi.fn(async (value: string) => {
      controller.abort(reason);
      return value;
    });
    if (phase === 'before') controller.abort(reason);
    await expect(mapSequentially(['A', 'B'], prepare, controller.signal)).rejects.toBe(reason);
    expect(prepare.mock.calls.map(([value]) => value)).toEqual(phase === 'before' ? [] : ['A']);
  });

  it('空输入保持返回空数组，不调用准备器', async () => {
    const controller = new AbortController();
    controller.abort();
    const prepare = vi.fn(async (value: string) => value);
    await expect(mapSequentially([], prepare, controller.signal)).resolves.toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('图片逐张交给现有解析器，保留厂商、信号和重复图片', async () => {
    const signal = new AbortController().signal;
    const urls = ['A', 'B', 'A'] as const;
    vi.mocked(resolveImageUrlArray).mockImplementation(async (items) => items.map((url) => `remote:${url}`));

    await expect(resolveImageUrlsSequentially(urls, 'provider-id', signal))
      .resolves.toEqual(['remote:A', 'remote:B', 'remote:A']);
    expect(vi.mocked(resolveImageUrlArray).mock.calls).toEqual([
      [['A'], 'provider-id', signal],
      [['B'], 'provider-id', signal],
      [['A'], 'provider-id', signal],
    ]);
    expect(urls).toEqual(['A', 'B', 'A']);
  });
});

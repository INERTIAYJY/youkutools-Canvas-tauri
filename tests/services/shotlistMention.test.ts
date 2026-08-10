/**
 * @ 引用分镜表：整表拼成文字 + 每行画面当参考图，以及参考素材超量提醒。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const showToast = vi.fn();
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: { getState: () => ({ nodes: [], edges: [], showToast }) },
  generateId: () => 'generated',
}));

import { resolveShotlistMention } from '../../src/services/ai/promptResolver';
import { warnIfTooManyReferences, REFERENCE_SOFT_LIMIT } from '../../src/services/ai/connectedReferenceMedia';
import type { BaseNodeData, ShotRow } from '../../src/types';

function shotlist(rows: ShotRow[]): BaseNodeData {
  return { type: 'ai-shotlist', label: '第一场', shotlistRows: rows } as BaseNodeData;
}

function collector() {
  const entries: { key: string; url?: string }[] = [];
  const addImage = (key: string, entry: { url: string }) => {
    const existing = entries.findIndex((item) => item.key === key);
    if (existing >= 0) return existing + 1;
    entries.push({ key, url: entry.url });
    return entries.length;
  };
  return { entries, addImage };
}

describe('分镜表 @ 引用', () => {
  it('逐行拼成「镜号 · 景别 · 运镜 · 内容 / 台词 · N″」，空行跳过', () => {
    const { addImage } = collector();
    const text = resolveShotlistMention(shotlist([
      { id: 'r1', shotNo: '1', shotSize: '全景', camera: '固定', content: '警察松动警戒线', dialogue: '让一让', duration: 1.5 },
      { id: 'r2', shotNo: '2' },
      { id: 'r3', shotNo: '3', content: '手铐扣紧', duration: 3 },
    ]), [], addImage);
    expect(text).toBe('1 · 全景 · 固定 · 警察松动警戒线 / 让一让 · 1.5″\n3 · 手铐扣紧 · 3″');
  });

  it('绑定的画面按画布实时素材带上，并在行尾标出图片序号', () => {
    const { entries, addImage } = collector();
    const nodes = [
      { id: 'img', type: 'ai-image', data: { type: 'ai-image', label: '警戒线', imageUrl: 'live.png' } as BaseNodeData },
    ];
    const text = resolveShotlistMention(shotlist([
      { id: 'r1', shotNo: '1', content: '警戒线', duration: 2, frame: { nodeId: 'img', kind: 'image', url: '旧快照.png' } },
    ]), nodes, addImage);
    expect(text).toBe('1 · 警戒线 · 2″（图片1）');
    expect(entries).toEqual([{ key: 'node:img', url: 'live.png' }]);
  });

  it('源节点已不在画布上时回落到绑定时的快照', () => {
    const { entries, addImage } = collector();
    const text = resolveShotlistMention(shotlist([
      { id: 'r1', shotNo: '1', content: '警戒线', duration: 2, frame: { nodeId: 'gone', kind: 'image', url: '快照.png' } },
    ]), [], addImage);
    expect(text).toContain('（图片1）');
    expect(entries[0].url).toBe('快照.png');
  });

  it('多行绑同一个节点只占一个参考图位置', () => {
    const { entries, addImage } = collector();
    const nodes = [{ id: 'img', type: 'ai-image', data: { type: 'ai-image', imageUrl: 'a.png' } as BaseNodeData }];
    const text = resolveShotlistMention(shotlist([
      { id: 'r1', shotNo: '1', content: 'A', duration: 1, frame: { nodeId: 'img', kind: 'image', url: 'a.png' } },
      { id: 'r2', shotNo: '2', content: 'B', duration: 1, frame: { nodeId: 'img', kind: 'image', url: 'a.png' } },
    ]), nodes, addImage);
    expect(text).toBe('1 · A · 1″（图片1）\n2 · B · 1″（图片1）');
    expect(entries).toHaveLength(1);
  });
});

describe('参考素材超量提醒', () => {
  beforeEach(() => showToast.mockClear());

  it('到阈值不吭声', () => {
    warnIfTooManyReferences({ image: REFERENCE_SOFT_LIMIT });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('图片、视频、音频合计超阈值时提醒一次并报出构成', () => {
    warnIfTooManyReferences({ image: 9, video: 2, audio: 1 });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toContain('12 项');
    expect(showToast.mock.calls[0][0]).toContain('图 9 · 视频 2 · 音频 1');
  });
});

/**
 * nodeMediaCopy — 回归测试：independent node media files。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseNodeData } from '../../src/types';

const mock = vi.hoisted(() => ({ copy: vi.fn(), persist: vi.fn(), trash: vi.fn() }));
vi.mock('../../src/services/fileService', () => ({
  copyFileToProjectData: mock.copy, persistMediaUrlToProjectData: mock.persist, moveToUndoTrash: mock.trash,
}));
vi.mock('../../src/services/fs/core', () => ({ isTauriEnv: () => true }));
import { copyNodeMedia, isNodeMediaCopySource } from '../../src/services/nodeMediaCopy';

const source: BaseNodeData = { type: 'ai-image', label: 'image', filePath: '/p/source.png',
  imageUrl: 'asset:///p/source.png', thumbnailUrl: 'asset:///p/source.png', assetId: 'old', relativePath: 'source.png' };

beforeEach(() => {
  vi.clearAllMocks();
  let sequence = 0;
  mock.copy.mockImplementation(async () => {
    const filePath = `/p/copy-${++sequence}.png`;
    return { filePath, assetUrl: `asset://${filePath}` };
  });
});

describe('independent node media files', () => {
  it('does not invent media fields for a file-only node', async () => {
    const result = await copyNodeMedia({ type: 'ai-text', label: 'text', filePath: '/p/text.txt', output: 'text' }, 'p');
    expect(result.imageUrl).toBeUndefined();
    expect(result.videoUrl).toBeUndefined();
    expect(result.audioUrl).toBeUndefined();
    expect(result.output).toBe('text');
  });
  it('allocates separate files for repeated copies without changing the source', async () => {
    const [a, b] = await Promise.all([copyNodeMedia(source, 'p'), copyNodeMedia(source, 'p')]);
    expect(a.filePath).not.toBe(b.filePath);
    expect(a.filePath).not.toBe(source.filePath);
    expect(a.assetId).toBeUndefined();
    expect(a.relativePath).toBeUndefined();
    expect(a.thumbnailUrl).toBe(a.imageUrl);
    expect(source.filePath).toBe('/p/source.png');
  });

  it('pins the source while queued and in progress, then releases it', async () => {
    let finish!: (value: unknown) => void;
    mock.copy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = copyNodeMedia(source, 'p');
    expect(isNodeMediaCopySource('/p/source.png')).toBe(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish({ filePath: '/p/new.png', assetUrl: 'asset:///p/new.png' });
    await pending;
    expect(isNodeMediaCopySource('/p/source.png')).toBe(false);
  });

  it('copies every storyboard cell even when they originally share one file', async () => {
    const result = await copyNodeMedia({ ...source, storyboardOverrides: [
      { filePath: source.filePath, url: source.imageUrl! },
      { filePath: source.filePath, url: source.imageUrl! },
    ] }, 'p');
    expect(new Set([result.filePath, ...result.storyboardOverrides!.map((cell) => cell!.filePath)]).size).toBe(3);
  });

  it('recycles only staged files after partial failure', async () => {
    mock.copy.mockResolvedValueOnce({ filePath: '/p/new.png', assetUrl: 'asset:///p/new.png' }).mockResolvedValueOnce(null);
    await expect(copyNodeMedia({ ...source, storyboardOverrides: [{ filePath: '/p/cell.png', url: 'asset:///p/cell.png' }] }, 'p')).rejects.toThrow('复制失败');
    expect(mock.trash).toHaveBeenCalledExactlyOnceWith('/p/new.png');
    expect(isNodeMediaCopySource('/p/source.png')).toBe(false);
  });

  it('persists remote media and does not allow content deduplication', async () => {
    mock.persist.mockResolvedValueOnce({ filePath: '/p/download.png', mediaUrl: 'asset:///p/download.png' });
    const result = await copyNodeMedia({ type: 'ai-image', label: 'remote', imageUrl: 'https://example.com/image.png' }, 'p');
    expect(result.filePath).toBe('/p/download.png');
    expect(mock.persist).toHaveBeenCalledWith(expect.any(String), 'p', 'copy', undefined, { deduplicateByContent: false, redactErrors: true });
  });
});

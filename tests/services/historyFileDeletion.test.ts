/**
 * historyFileDeletion — 回归测试：history file recycling。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ exists: vi.fn(), lstat: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: mock.exists, lstat: mock.lstat, mkdir: vi.fn(), rename: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
vi.mock('../../src/services/fs/core', () => ({ isTauriEnv: () => true, getProjectDataDir: async () => '/project/data',
  notifyProjectDiskChanged: vi.fn(), joinPath: (...parts: string[]) => parts.join('/') }));
import { recycleHistoryFile } from '../../src/services/fs/trash';

beforeEach(() => {
  vi.clearAllMocks();
  mock.exists.mockResolvedValue(true);
  mock.lstat.mockResolvedValue({ isFile: true, isSymlink: false });
  mock.invoke.mockResolvedValue(undefined);
});

describe('history file recycling', () => {
  it('uses system trash for an owned regular file', async () => {
    const check = vi.fn();
    await recycleHistoryFile('p', '/project/data/image.png', check);
    expect(check).toHaveBeenCalledWith(true);
    expect(mock.invoke).toHaveBeenCalledWith('move_to_trash', { path: '/project/data/image.png' });
  });
  it('reports a missing file without a native deletion', async () => {
    mock.exists.mockResolvedValue(false);
    const check = vi.fn();
    await recycleHistoryFile('p', '/project/data/image.png', check);
    expect(check).toHaveBeenCalledWith(false);
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it.each(['/other/file.png', '/project/data/../other.png', '/project/data'])('rejects an out-of-scope target: %s', async (path) => {
    await expect(recycleHistoryFile('p', path, vi.fn())).rejects.toThrow();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('rejects directories and symlinks', async () => {
    mock.lstat.mockResolvedValue({ isFile: false, isSymlink: false });
    await expect(recycleHistoryFile('p', '/project/data/folder', vi.fn())).rejects.toThrow();
    mock.lstat.mockResolvedValue({ isFile: true, isSymlink: true });
    await expect(recycleHistoryFile('p', '/project/data/link', vi.fn())).rejects.toThrow();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('checks project and references immediately before native deletion', async () => {
    await expect(recycleHistoryFile('p', '/project/data/image.png', () => { throw new Error('changed'); })).rejects.toThrow('changed');
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('propagates native failure without exposing its path', async () => {
    mock.invoke.mockRejectedValue(new Error('/private/path'));
    await expect(recycleHistoryFile('p', '/project/data/image.png', vi.fn())).rejects.toThrow('文件移入回收站失败');
  });
});

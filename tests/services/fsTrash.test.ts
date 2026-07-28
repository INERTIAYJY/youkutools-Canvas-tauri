import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  notifyProjectDiskChanged: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);
vi.mock('@tauri-apps/api/core', () => ({ invoke: coreMocks.invoke }));
const projectDirMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../src/services/fs/core', () => ({
  getProjectDataDir: projectDirMock.get,
  isTauriEnv: () => true,
  joinPath: (...parts: string[]) => parts.join('/'),
  notifyProjectDiskChanged: coreMocks.notifyProjectDiskChanged,
}));

import {
  deleteNodeFile,
  isPathInsideDir,
  isProjectOwnedFile,
  moveToUndoTrash,
  restoreFromUndoTrash,
} from '../../src/services/fs/trash';

describe('undo trash media moves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    coreMocks.invoke.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('renames media into undo trash and back without reading file contents', async () => {
    const originalPath = 'D:/project/media/generated-video.mp4';

    await moveToUndoTrash(originalPath);

    expect(fsMocks.mkdir).toHaveBeenCalledWith('D:/project/media/.trash', { recursive: true });
    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
    const trashPath = fsMocks.rename.mock.calls[0]?.[1] as string;
    expect(trashPath).toMatch(/^D:\/project\/media\/\.trash\/\d+-generated-video\.mp4$/);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
    expect(fsMocks.remove).not.toHaveBeenCalled();
    expect(coreMocks.notifyProjectDiskChanged).toHaveBeenCalledOnce();

    await expect(restoreFromUndoTrash(originalPath)).resolves.toBe(true);

    expect(fsMocks.rename).toHaveBeenNthCalledWith(2, trashPath, originalPath);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
    expect(coreMocks.notifyProjectDiskChanged).toHaveBeenCalledTimes(2);
  });

  it('falls back to the system trash when the atomic rename fails', async () => {
    const originalPath = 'D:/project/media/locked-video.mp4';
    fsMocks.rename.mockRejectedValueOnce(new Error('file is locked'));

    await moveToUndoTrash(originalPath);

    expect(coreMocks.invoke).toHaveBeenCalledWith('move_to_trash', { path: originalPath });
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
    await expect(restoreFromUndoTrash(originalPath)).resolves.toBe(false);
  });
});

describe('删除节点文件的项目归属校验', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    projectDirMock.get.mockResolvedValue('D:/data/project-b');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('路径归属判定兼容反斜杠、大小写与同前缀目录', () => {
    expect(isPathInsideDir('D:\\data\\project-b\\a.png', 'D:/data/project-b')).toBe(true);
    expect(isPathInsideDir('D:/DATA/Project-B/a.png', 'D:/data/project-b')).toBe(true);
    expect(isPathInsideDir('D:/data/project-b2/a.png', 'D:/data/project-b')).toBe(false);
    expect(isPathInsideDir('D:/data/project-a/a.png', 'D:/data/project-b')).toBe(false);
    // 目录本身不算「目录内的文件」
    expect(isPathInsideDir('D:/data/project-b', 'D:/data/project-b')).toBe(false);
  });

  it('跨项目复制来的文件不会被删除', async () => {
    // 当前项目是 B，但节点的 filePath 仍指向源项目 A
    await deleteNodeFile({ filePath: 'D:/data/project-a/original.png' }, undefined, 'project-b');

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });

  it('本项目内的文件正常移入 .trash', async () => {
    await deleteNodeFile({ filePath: 'D:/data/project-b/own.png' }, undefined, 'project-b');

    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
  });

  it('仍被其他存活节点引用的文件跳过删除', async () => {
    const keep = new Set(['D:/data/project-b/own.png']);
    await deleteNodeFile({ filePath: 'D:/data/project-b/own.png' }, keep, 'project-b');

    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it('没有当前项目时判定为不归属，不删任何文件', async () => {
    expect(await isProjectOwnedFile('D:/data/project-b/own.png', null)).toBe(false);
    await deleteNodeFile({ filePath: 'D:/data/project-b/own.png' }, undefined, null);

    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it('不传 projectId 时保持旧行为（调用方尚未接入校验）', async () => {
    await deleteNodeFile({ filePath: 'D:/data/project-a/original.png' });

    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
  });
});

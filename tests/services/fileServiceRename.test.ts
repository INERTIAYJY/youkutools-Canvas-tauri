import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripVerbatimPrefix } from '../../src/services/fs/core';

const mocks = vi.hoisted(() => ({
  getProjectDataDir: vi.fn(),
  rename: vi.fn(),
  resolveUniqueDestPath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  rename: mocks.rename,
  stat: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(), localDataDir: vi.fn() }));
vi.mock('../../src/services/fs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/fs/core')>();
  return {
    ...actual,
    CATEGORY_EXTENSIONS: {},
    arrayBufferToBase64: vi.fn(),
    buildNodeFileName: (label: string, ext: string) => `${label}${ext}`,
    ensureProjectDataDir: vi.fn(),
    getConvertFileSrc: () => (path: string) => `asset://${path}`,
    getFileCategory: vi.fn(),
    getMimeType: vi.fn(),
    getProjectDataDir: mocks.getProjectDataDir,
    isTauriEnv: () => true,
    joinPath: (...parts: string[]) => parts.join('/'),
    notifyProjectDiskChanged: vi.fn(),
    resolveUniqueDestPath: mocks.resolveUniqueDestPath,
    sanitizeFileName: (name: string) => name,
    sanitizeFolderName: (name: string) => name,
  };
});

import { renameProjectFileToLabel } from '../../src/services/fileService';

const PROJECT_DIR = 'F:\\素材\\项目 3-45b922a1';

describe('stripVerbatimPrefix', () => {
  it('去掉 Windows canonicalize 留下的 \\\\?\\ 前缀，其它路径原样返回', () => {
    expect(stripVerbatimPrefix('\\\\?\\F:\\素材\\a.png')).toBe('F:\\素材\\a.png');
    expect(stripVerbatimPrefix('//?/F:/素材/a.png')).toBe('F:/素材/a.png');
    expect(stripVerbatimPrefix('\\\\?\\UNC\\nas\\share\\a.png')).toBe('\\\\nas\\share\\a.png');
    expect(stripVerbatimPrefix('F:\\素材\\a.png')).toBe('F:\\素材\\a.png');
    expect(stripVerbatimPrefix('/home/me/a.png')).toBe('/home/me/a.png');
  });
});

describe('renameProjectFileToLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectDataDir.mockResolvedValue(PROJECT_DIR);
    mocks.resolveUniqueDestPath.mockImplementation(
      async (dir: string, fileName: string) => `${dir}/${fileName}`,
    );
  });

  it('重命名带 \\\\?\\ 前缀的路径（原生命令返回的形式）', async () => {
    const result = await renameProjectFileToLabel(
      `\\\\?\\${PROJECT_DIR}\\生成图像_4.png`,
      'H 氢 · 蜂鸟速射手',
      'project-1',
    );

    expect(mocks.rename).toHaveBeenCalledWith(
      `\\\\?\\${PROJECT_DIR}\\生成图像_4.png`,
      'F:/素材/项目 3-45b922a1/H 氢 · 蜂鸟速射手.png',
    );
    expect(result?.fileName).toBe('H 氢 · 蜂鸟速射手.png');
  });

  it('分组子文件夹内的文件就地改名，不搬回项目根目录', async () => {
    const result = await renameProjectFileToLabel(
      `${PROJECT_DIR}\\分组A\\生成图像_8.png`,
      '角色立绘',
      'project-1',
    );

    expect(result?.filePath).toBe('F:/素材/项目 3-45b922a1/分组A/角色立绘.png');
  });

  it('项目目录外的文件不动', async () => {
    const result = await renameProjectFileToLabel('D:\\别处\\a.png', 'b', 'project-1');
    expect(result).toBeNull();
    expect(mocks.rename).not.toHaveBeenCalled();
  });
});

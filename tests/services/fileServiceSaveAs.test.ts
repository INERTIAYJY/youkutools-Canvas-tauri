import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: mocks.readFile,
  rename: vi.fn(),
  stat: vi.fn(),
  writeFile: mocks.writeFile,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: mocks.save }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: mocks.convertFileSrc, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(), localDataDir: vi.fn() }));
vi.mock('../../src/services/fs/core', () => ({
  CATEGORY_EXTENSIONS: {},
  arrayBufferToBase64: vi.fn(),
  buildNodeFileName: vi.fn(),
  ensureProjectDataDir: vi.fn(),
  getConvertFileSrc: () => null,
  getFileCategory: vi.fn(),
  getMimeType: vi.fn(),
  getProjectDataDir: vi.fn(),
  isTauriEnv: () => true,
  joinPath: (...parts: string[]) => parts.join('/'),
  notifyProjectDiskChanged: vi.fn(),
  resolveUniqueDestPath: vi.fn(),
  sanitizeFileName: (name: string) => name,
  sanitizeFolderName: (name: string) => name,
  stripVerbatimPrefix: (p: string) => p,
}));

import { saveNodeOutputToFile } from '../../src/services/fileService';

/** mac 的 asset URL 形如 asset://localhost/<encoded path>；Windows 是 http://asset.localhost/… */
const MAC_ASSET_URL = 'asset://localhost/%2FUsers%2Fme%2FLibrary%2Fout.png';

describe('saveNodeOutputToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue('/Users/me/Desktop/out.png');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // 只有原样的 asset URL 才可读；被 convertFileSrc 二次编码后取不到文件
      if (url !== MAC_ASSET_URL) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }));
  });

  it('mac 的 asset:// URL 直接 fetch，不再二次 convertFileSrc', async () => {
    const dest = await saveNodeOutputToFile({
      mediaUrl: MAC_ASSET_URL,
      nodeType: 'ai-image',
      fileName: 'out.png',
    });

    expect(dest).toBe('/Users/me/Desktop/out.png');
    expect(mocks.convertFileSrc).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(dest, new Uint8Array([1, 2, 3]));
  });

  it('源文件读不出来时回退到节点 URL', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'));

    const dest = await saveNodeOutputToFile({
      filePath: '/gone/out.png',
      mediaUrl: MAC_ASSET_URL,
      nodeType: 'ai-image',
      fileName: 'out.png',
    });

    expect(dest).toBe('/Users/me/Desktop/out.png');
    expect(mocks.writeFile).toHaveBeenCalledWith(dest, new Uint8Array([1, 2, 3]));
  });

  it('没有任何可回退内容时仍然抛错', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(
      saveNodeOutputToFile({ filePath: '/gone/out.png', nodeType: 'ai-image' }),
    ).rejects.toThrow('ENOENT');
  });
});

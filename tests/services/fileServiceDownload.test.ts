import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appDataDir: vi.fn(async () => '/project/app'),
  ensureProjectDataDir: vi.fn(),
  exists: vi.fn(async (_path: string) => false),
  invoke: vi.fn(),
  isTauriEnv: vi.fn(() => true),
  notifyProjectDiskChanged: vi.fn(),
  resolveUniqueDestPath: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mocks.exists,
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  writeFile: mocks.writeFile,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn(),
  invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: mocks.appDataDir, localDataDir: vi.fn() }));
vi.mock('../../src/services/fs/core', () => ({
  CATEGORY_EXTENSIONS: {},
  arrayBufferToBase64: vi.fn(),
  buildNodeFileName: (label: string, ext: string) => `${label}${ext}`,
  ensureProjectDataDir: mocks.ensureProjectDataDir,
  getAssetUrlFromPath: async (path: string) => `asset://${path}`,
  getConvertFileSrc: () => (path: string) => `asset://${path}`,
  getFileCategory: vi.fn(),
  getMimeType: vi.fn(),
  getProjectDataDir: vi.fn(),
  isTauriEnv: () => mocks.isTauriEnv(),
  joinPath: (...parts: string[]) => parts.join('/'),
  notifyProjectDiskChanged: mocks.notifyProjectDiskChanged,
  resolveUniqueDestPath: mocks.resolveUniqueDestPath,
  sanitizeFileName: (name: string) => name,
  sanitizeFolderName: (name: string) => name,
}));

import {
  downloadUrlAndSave,
  persistMediaUrlToProjectData,
  resolveProjectOutputPath,
  saveDataUrlToProjectData,
} from '../../src/services/fileService';

describe('downloadUrlAndSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriEnv.mockReturnValue(true);
    mocks.ensureProjectDataDir.mockResolvedValue('/project/data');
    mocks.exists.mockResolvedValue(false);
    mocks.resolveUniqueDestPath.mockImplementation(async (dataDir: string, fileName: string) => (
      `${dataDir}/${fileName}`
    ));
  });

  it('serializes same-name downloads until the first destination exists', async () => {
    const existingPaths = new Set<string>();
    mocks.resolveUniqueDestPath.mockImplementation(async (dataDir: string, fileName: string) => {
      const dotIndex = fileName.lastIndexOf('.');
      const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
      const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
      let candidate = `${dataDir}/${fileName}`;
      let counter = 1;
      while (existingPaths.has(candidate)) {
        candidate = `${dataDir}/${baseName}_${counter}${extension}`;
        counter += 1;
      }
      return candidate;
    });

    let releaseFirstDownload: () => void = () => undefined;
    const firstDownloadGate = new Promise<void>((resolve) => {
      releaseFirstDownload = resolve;
    });
    let downloadCount = 0;
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, string>) => {
      if (command !== 'download_file_streamed') return undefined;
      downloadCount += 1;
      if (downloadCount === 1) await firstDownloadGate;
      existingPaths.add(args.destinationPath);
      return { path: args.destinationPath, totalBytes: 1, contentType: 'image/png' };
    });

    const first = downloadUrlAndSave(
      'https://example.com/first.png',
      'project-1',
      'ai-image',
      'AI 图片',
    );
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));

    const second = downloadUrlAndSave(
      'https://example.com/second.png',
      'project-1',
      'ai-image',
      'AI 图片',
    );
    await vi.waitFor(() => expect(mocks.ensureProjectDataDir).toHaveBeenCalledTimes(2));

    expect(mocks.resolveUniqueDestPath).toHaveBeenCalledTimes(1);
    releaseFirstDownload();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { filePath: '/project/data/AI 图片.png', assetUrl: 'asset:///project/data/AI 图片.png' },
      { filePath: '/project/data/AI 图片_1.png', assetUrl: 'asset:///project/data/AI 图片_1.png' },
    ]);
    expect(mocks.resolveUniqueDestPath).toHaveBeenCalledTimes(2);
  });

  it('writes base64 image results directly into the project directory', async () => {
    const result = await downloadUrlAndSave(
      'data:image/png;base64,AQID',
      'project-1',
      'ai-image',
      '自定义接口图片',
    );

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/project/data/自定义接口图片.png',
      new Uint8Array([1, 2, 3]),
    );
    expect(result).toEqual({
      filePath: '/project/data/自定义接口图片.png',
      assetUrl: 'asset:///project/data/自定义接口图片.png',
    });
  });

  it('reuses the same content-addressed file during persistence retries', async () => {
    const writtenPaths = new Set<string>();
    mocks.exists.mockImplementation(async (path: string) => writtenPaths.has(path));
    mocks.writeFile.mockImplementation(async (path: string) => {
      writtenPaths.add(path);
    });

    const first = await saveDataUrlToProjectData(
      'data:image/png;base64,AQID',
      'project-1',
      '历史图片.png',
      { deduplicateByContent: true },
    );
    const second = await saveDataUrlToProjectData(
      'data:image/png;base64,AQID',
      'project-1',
      '历史图片.png',
      { deduplicateByContent: true },
    );

    expect(first).toEqual(second);
    expect(first?.filePath).toMatch(/^\/project\/data\/历史图片-[a-f0-9]{20}\.png$/);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.notifyProjectDiskChanged).toHaveBeenCalledTimes(1);
  });

  it('writes blob video results directly into the project directory', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Uint8Array([4, 5, 6]),
      { headers: { 'content-type': 'video/mp4' } },
    ));

    const result = await downloadUrlAndSave(
      'blob:http://localhost/generated-video',
      'project-1',
      'ai-video',
      '自定义接口视频',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'blob:http://localhost/generated-video',
      { signal: undefined },
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/project/data/自定义接口视频.mp4',
      new Uint8Array([4, 5, 6]),
    );
    expect(result).toEqual({
      filePath: '/project/data/自定义接口视频.mp4',
      assetUrl: 'asset:///project/data/自定义接口视频.mp4',
    });

    fetchMock.mockRestore();
  });

  it('allocates local processor outputs inside the project directory', async () => {
    await expect(resolveProjectOutputPath('project-1', '主体识别.png'))
      .resolves.toBe('/project/data/主体识别.png');
    expect(mocks.resolveUniqueDestPath).toHaveBeenCalledWith('/project/data', '主体识别.png');
  });
});

describe('persistMediaUrlToProjectData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriEnv.mockReturnValue(true);
    mocks.ensureProjectDataDir.mockResolvedValue('/project/data');
    mocks.exists.mockResolvedValue(false);
    mocks.writeFile.mockReset();
    mocks.invoke.mockReset();
    mocks.resolveUniqueDestPath.mockImplementation(async (dataDir: string, fileName: string) => (
      `${dataDir}/${fileName}`
    ));
  });

  it('keeps the source url when there is no project directory to write into', async () => {
    mocks.isTauriEnv.mockReturnValue(false);

    await expect(persistMediaUrlToProjectData(
      'https://cdn.example/generated.png',
      'project-1',
      'ai-image',
      '自定义接口图片',
    )).resolves.toEqual({
      mediaUrl: 'https://cdn.example/generated.png',
      sourceUrl: 'https://cdn.example/generated.png',
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('refuses inline media when there is no project directory to write into', async () => {
    mocks.isTauriEnv.mockReturnValue(false);

    await expect(persistMediaUrlToProjectData(
      'data:image/png;base64,AQID',
      'project-1',
      'ai-image',
      '自定义接口图片',
    )).rejects.toThrow('当前环境没有项目目录');
  });

  it('fails closed instead of returning a temporary media url', async () => {
    mocks.ensureProjectDataDir.mockResolvedValueOnce(null);

    await expect(persistMediaUrlToProjectData(
      'https://cdn.example/generated.png',
      'project-1',
      'ai-image',
      '自定义接口图片',
    )).rejects.toThrow('生成媒体未能写入项目目录');
  });

  it.each([
    ['directory', 'forbidden path: C:/private/user/project', '应用拒绝访问项目文件，请在设置中重新选择文件保存目录'],
    ['write', new Error('Access is denied. (os error 5): C:/private/user/image.png'), '系统拒绝写入项目目录，请检查目录的写入权限'],
    ['exists', 'forbidden path: C:/private/user/image.png', '应用拒绝访问项目文件，请在设置中重新选择文件保存目录'],
    ['download', '下载请求失败: HTTP 403 Forbidden https://cdn.example/image?token=private-token', '图片或媒体下载失败（HTTP 403）'],
    ['download', '目标磁盘空间不足，需要至少 999 字节，当前可用 1 字节', '目标磁盘空间不足'],
    ['download', '下载请求失败: connection timed out https://cdn.example/private-token', '下载媒体失败，请检查网络或媒体链接是否已失效'],
    ['write', new Error('unknown private-token C:/private/user/image.png'), '保存过程发生异常，请检查文件保存目录和媒体来源'],
  ])('reports a safe reason for %s failures', async (operation, failure, reason) => {
    const log = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    if (operation === 'directory') mocks.ensureProjectDataDir.mockRejectedValueOnce(failure);
    if (operation === 'write') mocks.writeFile.mockRejectedValueOnce(failure);
    if (operation === 'exists') mocks.exists.mockRejectedValueOnce(failure);
    if (operation === 'download') mocks.invoke.mockRejectedValueOnce(failure);

    const error = await persistMediaUrlToProjectData(
      operation === 'download' ? 'https://cdn.example/generated.png' : 'data:image/png;base64,AQID',
      'project-1', 'ai-image', '图片', { deduplicateByContent: true },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`生成媒体未能写入项目目录：${reason}`);
    expect(error).not.toHaveProperty('cause');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    if (operation === 'directory' || operation === 'exists') expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.ensureProjectDataDir).toHaveBeenCalledWith('project-1', { throwOnError: true });
  });

  it('propagates blob write failures instead of replacing them with a generic failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'image/png' },
    }));
    mocks.writeFile.mockRejectedValueOnce('forbidden path');

    await expect(persistMediaUrlToProjectData(
      'blob:http://localhost/generated-image', 'project-1', 'ai-image',
    )).rejects.toThrow('应用拒绝访问项目文件');
  });

  it('keeps optional download failures nullable for existing callers', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('write failed'));
    await expect(downloadUrlAndSave('data:image/png;base64,AQID', 'project-1', 'ai-image'))
      .resolves.toBeNull();
  });

  it('preserves cancellation without putting the abort reason in the error', async () => {
    const controller = new AbortController();
    controller.abort(new Error('private-token'));
    await expect(persistMediaUrlToProjectData(
      'https://cdn.example/generated.png', 'project-1', 'ai-image', undefined, { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError', message: '媒体保存已取消' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('project directory error propagation', () => {
  it('lets strict persistence receive the real directory error without logging paths', async () => {
    const core = await vi.importActual<typeof import('../../src/services/fs/core')>('../../src/services/fs/core');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    core.setBaseDataDir(undefined);
    const failure = new Error('forbidden path: C:/private/user/project');
    mocks.exists.mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, 'error');

    await expect(core.ensureProjectDataDir('project-1', { throwOnError: true })).rejects.toBe(failure);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps directory failures nullable for existing callers', async () => {
    const core = await vi.importActual<typeof import('../../src/services/fs/core')>('../../src/services/fs/core');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    core.setBaseDataDir(undefined);
    mocks.exists.mockRejectedValueOnce(new Error('forbidden path'));

    await expect(core.ensureProjectDataDir('project-1')).resolves.toBeNull();
  });
});

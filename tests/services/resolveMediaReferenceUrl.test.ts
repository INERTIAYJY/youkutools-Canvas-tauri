import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFileToDataUrl: vi.fn(),
}));

vi.mock('../../src/services/fileService', () => ({
  readFileToDataUrl: mocks.readFileToDataUrl,
}));

import { resolveMediaReferenceUrl } from '../../src/services/uploadService';

describe('resolveMediaReferenceUrl — 本地媒体参考统一分发', () => {
  beforeEach(() => {
    mocks.readFileToDataUrl.mockReset();
  });

  it('公网 URL 与 data URL 原样返回，不做任何转换', async () => {
    await expect(resolveMediaReferenceUrl('https://cdn.example/a.mp4', { kind: 'video' }))
      .resolves.toBe('https://cdn.example/a.mp4');
    await expect(resolveMediaReferenceUrl('data:audio/mp3;base64,AAAA', { kind: 'audio' }))
      .resolves.toBe('data:audio/mp3;base64,AAAA');
    expect(mocks.readFileToDataUrl).not.toHaveBeenCalled();
  });

  it('dataUrl 模式：本地文件转 base64 data URL', async () => {
    mocks.readFileToDataUrl.mockResolvedValue('data:video/mp4;base64,VIDEO');
    await expect(resolveMediaReferenceUrl('asset://localhost/v.mp4', { mode: 'dataUrl', kind: 'video' }))
      .resolves.toBe('data:video/mp4;base64,VIDEO');
    expect(mocks.readFileToDataUrl).toHaveBeenCalledWith('asset://localhost/v.mp4');
  });

  it('dataUrl 模式：本地文件读取失败时抛出可读错误', async () => {
    mocks.readFileToDataUrl.mockResolvedValue(null);
    await expect(resolveMediaReferenceUrl('asset://localhost/v.mp4', { mode: 'dataUrl', kind: 'video' }))
      .rejects.toThrow('无法读取本地视频参考');
  });
});

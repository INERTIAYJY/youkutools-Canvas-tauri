import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DramaCharacter } from '../../src/types/dramaAssets';

const fileMocks = vi.hoisted(() => ({
  tauri: false,
  saveAssetToPermanent: vi.fn(async () => 'D:/global/character.png'),
  getGlobalFilesDir: vi.fn(async () => 'D:/global'),
  identifyAsset: vi.fn(async () => ({
    assetId: 'asset-global',
    relativePath: 'character.png',
  })),
  getAssetUrlFromPath: vi.fn(async (path: string) => `asset://${path}`),
  resolveIndexedAssetPath: vi.fn(async () => null),
}));

vi.mock('../../src/services/fileService', () => ({
  isTauriEnv: () => fileMocks.tauri,
  saveAssetToPermanent: fileMocks.saveAssetToPermanent,
  getGlobalFilesDir: fileMocks.getGlobalFilesDir,
  identifyAsset: fileMocks.identifyAsset,
  getAssetUrlFromPath: fileMocks.getAssetUrlFromPath,
  resolveIndexedAssetPath: fileMocks.resolveIndexedAssetPath,
  sanitizeFileName: (name: string) => name,
}));

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  });
  vi.resetModules();
  vi.clearAllMocks();
  fileMocks.tauri = false;
});

function character(id: string, updatedAt: number): DramaCharacter {
  return {
    kind: 'character',
    id,
    key: id,
    name: id,
    summary: '',
    visualNotes: '',
    identity: '',
    importance: 'main',
    confirmed: true,
    createdAt: 1,
    updatedAt,
    source: 'manual',
    imageNodeId: `node-${id}`,
    referenceImages: [{
      id: `ref-${id}`,
      kind: 'primary',
      imageUrl: `data:image/png;base64,${id}`,
      sourceNodeId: `node-${id}`,
      prompt: id,
      createdAt: 1,
      updatedAt,
    }],
    primaryReferenceImageId: `ref-${id}`,
  };
}

describe('characterLibraryService', () => {
  it('removes project node links before persisting a global card', async () => {
    const service = await import('../../src/services/characterLibraryService');
    const saved = await service.saveGlobalCharacterCard(character('角色甲', 2));

    expect(saved.imageNodeId).toBeUndefined();
    expect(saved.referenceImages?.[0].sourceNodeId).toBeUndefined();
    expect(saved.referenceImages?.[0].imageUrl).toContain('角色甲');
  });

  it('loads global cards newest first and supports deletion', async () => {
    const service = await import('../../src/services/characterLibraryService');
    await service.saveGlobalCharacterCard(character('旧角色', 2));
    await service.saveGlobalCharacterCard(character('新角色', 3));

    expect((await service.loadGlobalCharacterCards()).map((item) => item.id)).toEqual([
      '新角色',
      '旧角色',
    ]);

    await service.deleteGlobalCharacterCard('新角色');
    expect((await service.loadGlobalCharacterCards()).map((item) => item.id)).toEqual(['旧角色']);
  });

  it('copies reference images before persisting in Tauri', async () => {
    fileMocks.tauri = true;
    const service = await import('../../src/services/characterLibraryService');

    const saved = await service.saveGlobalCharacterCard(character('桌面角色', 4));

    expect(fileMocks.saveAssetToPermanent).toHaveBeenCalledOnce();
    expect(saved.referenceImages?.[0]).toEqual(expect.objectContaining({
      assetId: 'asset-global',
      relativePath: 'character.png',
      imageUrl: 'asset://D:/global/character.png',
    }));
    expect(saved.referenceImages?.[0]).not.toHaveProperty('sourceNodeId');
  });
});

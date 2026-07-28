import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(async () => true),
  identifyAsset: vi.fn(),
  walkDirectoryFiles: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: mocks.exists }));
vi.mock('../../src/services/fs/core', () => ({
  getAssetUrlFromPath: vi.fn(async (path: string) => `asset://${path}`),
  getProjectDataDir: vi.fn(async () => '/project/data'),
  joinPath: (...parts: string[]) => parts.join('/'),
}));
vi.mock('../../src/services/fs/assetLibrary', () => ({
  walkDirectoryFiles: mocks.walkDirectoryFiles,
}));
vi.mock('../../src/services/fs/assetIndex', () => ({
  identifyAsset: mocks.identifyAsset,
  resolveIndexedAssetPath: vi.fn(async () => null),
}));

import {
  getLastActiveProjectId,
  saveProjectToDb,
  setLastActiveProjectId,
} from '../../src/services/indexedDbService';
import { loadProjectData } from '../../src/services/storageService';

describe('project loading tolerates asset recovery failures', () => {
  beforeEach(() => {
    mocks.exists.mockResolvedValue(true);
    mocks.identifyAsset.mockRejectedValue(new Error('asset index unavailable'));
    mocks.walkDirectoryFiles.mockRejectedValue(new Error('directory scan unavailable'));
  });

  it('returns the persisted canvas when scanning and indexing an asset fail', async () => {
    const projectId = `project-load-${Date.now()}`;
    await saveProjectToDb({
      id: projectId,
      name: 'Recoverable project',
      createdAt: 1,
      updatedAt: 2,
      nodes: [{
        id: 'image-node',
        type: 'ai-image',
        position: { x: 10, y: 20 },
        data: {
          type: 'ai-image',
          label: 'Saved image',
          assetId: 'asset-saved',
          relativePath: 'saved.png',
          imageUrl: 'asset://stale',
        },
      }],
      edges: [],
    });

    const loaded = await loadProjectData(projectId);

    expect(loaded).not.toBeNull();
    expect(loaded?.nodes).toEqual([expect.objectContaining({
      id: 'image-node',
      position: { x: 10, y: 20 },
      data: expect.objectContaining({
        assetId: 'asset-saved',
        filePath: '/project/data/saved.png',
        imageUrl: 'asset:///project/data/saved.png',
      }),
    })]);
  });

  it('persists the last successfully opened project in metadata', async () => {
    const projectId = `project-active-${Date.now()}`;

    await setLastActiveProjectId(projectId);

    await expect(getLastActiveProjectId()).resolves.toBe(projectId);
  });
});

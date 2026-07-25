import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { countUnreadDramaAssets } from '../../src/store/store.dramaAssets';
import type { DramaCharacter } from '../../src/types/dramaAssets';
import { emptyDramaAssetLibrary } from '../../src/types/dramaAssets';

const characterLibraryMocks = vi.hoisted(() => ({
  loadGlobalCharacterCards: vi.fn(async () => [] as DramaCharacter[]),
  saveGlobalCharacterCard: vi.fn(async (character: DramaCharacter) => character),
  deleteGlobalCharacterCard: vi.fn(async () => undefined),
  clearGlobalCharacterCards: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/characterLibraryService', () => characterLibraryMocks);

beforeEach(() => {
  vi.clearAllMocks();
  characterLibraryMocks.loadGlobalCharacterCards.mockResolvedValue([]);
  characterLibraryMocks.saveGlobalCharacterCard.mockImplementation(async (character) => character);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    saveCurrentProjectSilent: vi.fn(async () => 'p1'),
    showToast: vi.fn(),
    currentProjectId: 'p1',
    projects: [{ id: 'p1', name: 'Test', createdAt: 1, updatedAt: 1 }],
  });
});

function sampleCharacter(overrides: Partial<DramaCharacter> = {}): DramaCharacter {
  return {
    kind: 'character',
    id: 'char_1',
    key: '主角',
    name: '主角',
    summary: '简介',
    visualNotes: '外形',
    identity: '身份',
    importance: 'main',
    confirmed: false,
    createdAt: 1,
    updatedAt: 1,
    source: 'ai',
    ...overrides,
  };
}

describe('dramaAssets store', () => {
  it('counts only assets created after the library was viewed', () => {
    const library = {
      ...emptyDramaAssetLibrary(),
      lastViewedAt: 10,
      characters: [
        sampleCharacter({ id: 'old', createdAt: 10 }),
        sampleCharacter({ id: 'new', createdAt: 11 }),
      ],
    };

    expect(countUnreadDramaAssets(library)).toBe(1);
    expect(countUnreadDramaAssets({ ...library, lastViewedAt: undefined })).toBe(0);
  });

  it('merges extract into library and silent-saves', () => {
    const save = useAppStore.getState().saveCurrentProjectSilent as ReturnType<typeof vi.fn>;
    useAppStore.getState().mergeDramaExtract({
      kind: 'character',
      characters: [sampleCharacter()],
      scenes: [],
      props: [],
    });
    const lib = useAppStore.getState().dramaAssets;
    expect(lib.characters).toHaveLength(1);
    expect(lib.characters[0].name).toBe('主角');
    expect(countUnreadDramaAssets(lib)).toBe(1);
    expect(useAppStore.getState().assetsPanelOpen).toBe(true);
    expect(useAppStore.getState().dramaAssetsPanelOpen).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it('marks drama assets as viewed and silent-saves', () => {
    const save = useAppStore.getState().saveCurrentProjectSilent as ReturnType<typeof vi.fn>;
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter({ createdAt: Date.now() })],
      },
    });

    useAppStore.getState().markDramaAssetsViewed();

    expect(useAppStore.getState().dramaAssets.lastViewedAt).toEqual(expect.any(Number));
    expect(countUnreadDramaAssets(useAppStore.getState().dramaAssets)).toBe(0);
    expect(save).toHaveBeenCalled();
  });

  it('bind / unbind image and sync from node', () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter()],
      },
      nodes: [
        {
          id: 'node-img',
          type: 'ai-image',
          position: { x: 0, y: 0 },
          data: { label: '图', type: 'ai-image', imageUrl: 'https://cdn/x.png' },
        },
      ],
    });

    useAppStore.getState().bindDramaAssetImage('character', 'char_1', 'node-img');
    let asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset.imageNodeId).toBe('node-img');
    expect(asset.imageUrl).toBe('https://cdn/x.png');
    expect(asset.referenceImages).toEqual([
      expect.objectContaining({
        kind: 'primary',
        sourceNodeId: 'node-img',
        imageUrl: 'https://cdn/x.png',
      }),
    ]);

    useAppStore.getState().syncDramaAssetImageFromNode('node-img', 'https://cdn/y.png');
    asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset.imageUrl).toBe('https://cdn/y.png');
    expect(asset.referenceImages?.[0].imageUrl).toBe('https://cdn/y.png');

    useAppStore.getState().unbindDramaAssetImage('character', 'char_1');
    asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset.imageNodeId).toBeUndefined();
    expect(asset.imageUrl).toBeUndefined();
    expect(asset.referenceImages).toEqual([]);
  });

  it('adds multiple references without duplicating the same source node', async () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter()],
      },
    });
    const reference = {
      id: 'ref-full',
      kind: 'full_body' as const,
      imageUrl: 'https://cdn/full.png',
      sourceNodeId: 'node-full',
      prompt: '全身提示词',
      createdAt: 1,
      updatedAt: 1,
    };

    await useAppStore.getState().addCharacterReferenceImage(
      'project',
      'char_1',
      reference,
      { makePrimary: true },
    );
    await useAppStore.getState().addCharacterReferenceImage(
      'project',
      'char_1',
      { ...reference, imageUrl: 'https://cdn/full-v2.png', updatedAt: 2 },
    );

    const character = useAppStore.getState().dramaAssets.characters[0];
    expect(character.referenceImages).toHaveLength(1);
    expect(character.referenceImages?.[0].imageUrl).toBe('https://cdn/full-v2.png');
    expect(character.primaryReferenceImageId).toBe('ref-full');
  });

  it('stores a normalized avatar crop against a reference', async () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter({
          referenceImages: [{
            id: 'ref-avatar',
            kind: 'avatar',
            imageUrl: 'https://cdn/avatar.png',
            prompt: '',
            createdAt: 1,
            updatedAt: 1,
          }],
        })],
      },
    });

    await useAppStore.getState().setCharacterAvatar(
      'project',
      'char_1',
      'ref-avatar',
      { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
    );

    expect(useAppStore.getState().dramaAssets.characters[0]).toEqual(expect.objectContaining({
      avatarReferenceImageId: 'ref-avatar',
      avatarCrop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
    }));
  });

  it('loads permanent characters and copies them into the project independently', async () => {
    characterLibraryMocks.loadGlobalCharacterCards.mockResolvedValue([
      sampleCharacter({ id: 'global-1', name: '永久角色', key: '永久角色' }),
    ]);

    await useAppStore.getState().loadGlobalCharacters();
    expect(useAppStore.getState().globalCharacters).toHaveLength(1);

    const projectId = useAppStore.getState().copyGlobalCharacterToProject('global-1');
    expect(projectId).toBeTruthy();
    expect(projectId).not.toBe('global-1');
    expect(useAppStore.getState().dramaAssets.characters[0].name).toBe('永久角色');
  });

  it('copies a project character to permanent storage before updating state', async () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter()],
      },
    });
    characterLibraryMocks.saveGlobalCharacterCard.mockImplementation(async (character) => ({
      ...character,
      imageNodeId: undefined,
    }));

    const globalId = await useAppStore.getState().copyCharacterToGlobal('char_1');

    expect(characterLibraryMocks.saveGlobalCharacterCard).toHaveBeenCalledOnce();
    expect(globalId).toBeTruthy();
    expect(globalId).not.toBe('char_1');
    expect(useAppStore.getState().globalCharacters[0].id).toBe(globalId);
  });

  it('createImageNodeFromDramaAsset creates node, fills prompt, binds', () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter()],
      },
      nodes: [],
    });

    const nodeId = useAppStore.getState().createImageNodeFromDramaAsset('character', 'char_1');
    expect(nodeId).toBeTruthy();

    const nodes = useAppStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.type).toBe('ai-image');
    expect(node.data.dramaAssetId).toBe('char_1');
    expect(node.data.prompt).toContain('定妆');
    expect(node.data.prompt).toContain('主角');
    expect(node.data.aspectRatio).toBe('3:4');

    const asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset.imageNodeId).toBe(nodeId);
  });

  it('confirm and delete asset', () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter()],
      },
    });
    useAppStore.getState().confirmDramaAsset('character', 'char_1', true);
    expect(useAppStore.getState().dramaAssets.characters[0].confirmed).toBe(true);
    useAppStore.getState().deleteDramaAsset('character', 'char_1');
    expect(useAppStore.getState().dramaAssets.characters).toHaveLength(0);
  });

  it('renaming updates key for future merge', () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter({ name: '旧名', key: '旧名' })],
      },
    });
    useAppStore.getState().updateDramaAssetFields('character', 'char_1', {
      name: '新 角色',
      summary: '简介',
      visualNotes: '外形',
    });
    const asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset.name).toBe('新 角色');
    expect(asset.key).toBe('新角色');
  });

  it('unbind fully removes image fields', () => {
    useAppStore.setState({
      dramaAssets: {
        ...emptyDramaAssetLibrary(),
        characters: [sampleCharacter({ imageNodeId: 'n1', imageUrl: 'http://x' })],
      },
    });
    useAppStore.getState().unbindDramaAssetImage('character', 'char_1');
    const asset = useAppStore.getState().dramaAssets.characters[0];
    expect(asset).not.toHaveProperty('imageNodeId');
    expect(asset).not.toHaveProperty('imageUrl');
  });
});

/**
 * 项目级短剧资产库（人物 / 场景 / 道具）
 */
import type { StateCreator } from 'zustand';
import type { Node } from '@xyflow/react';
import type { AppState } from './useAppStore';
import type {
  CharacterCropRect,
  CharacterReferenceImage,
  CharacterReferenceKind,
  DramaAsset,
  DramaAssetKind,
  DramaAssetLibrary,
  DramaCharacter,
} from '../types/dramaAssets';
import { emptyDramaAssetLibrary, normalizeDramaCharacter } from '../types/dramaAssets';
import type { DramaExtractParseResult } from '../services/dramaAssetExtract';
import { mergeDramaExtractIntoLibrary, normalizeAssetKey } from '../services/dramaAssetExtract';
import {
  buildDramaAssetImagePrompt,
  defaultAspectRatioForAsset,
  defaultPurposeForKind,
  findDramaAssetByKind,
  purposeLabel,
} from '../services/dramaAssetPrompt';
import { generateId } from './store.utils';
import type { BaseNodeData, CharacterLibraryNodeLink } from '../types';
import {
  clearGlobalCharacterCards,
  deleteGlobalCharacterCard,
  loadGlobalCharacterCards,
  saveGlobalCharacterCard,
} from '../services/characterLibraryService';

export type CharacterLibraryScope = 'project' | 'global';

const CHARACTER_REFERENCE_NODE_TYPES = new Set([
  'ai-image',
  'source-image',
  'ai-panorama',
  'ai-storyboard',
  'ai-animation',
]);

export function isEligibleCharacterReferenceNode(
  node: Pick<Node<BaseNodeData>, 'type' | 'data'> | undefined,
): boolean {
  if (!node?.type || !CHARACTER_REFERENCE_NODE_TYPES.has(node.type)) return false;
  return Boolean(node.data.imageUrl || node.data.thumbnailUrl);
}

export interface CaptureImageNodeToCharacterInput {
  nodeId: string;
  scope: CharacterLibraryScope;
  characterId?: string;
  newCharacter?: DramaCharacter;
  kind: CharacterReferenceKind;
  prompt: string;
  hideNode: boolean;
}

export interface CaptureImageNodeToCharacterResult {
  characterId: string;
  referenceImageId: string;
}

export interface DramaAssetsSlice {
  dramaAssets: DramaAssetLibrary;
  globalCharacters: DramaCharacter[];
  globalCharactersLoading: boolean;
  dramaAssetsPanelOpen: boolean;
  setDramaAssetsPanelOpen: (open: boolean) => void;
  markDramaAssetsViewed: () => void;
  setDramaAssets: (library: DramaAssetLibrary) => void;
  resetDramaAssets: () => void;
  /** 提取成功后合并入库 */
  mergeDramaExtract: (
    parsed: DramaExtractParseResult,
    meta?: { sourceNodeId?: string; modelId?: string },
  ) => void;
  confirmDramaAsset: (kind: DramaAssetKind, id: string, confirmed?: boolean) => void;
  deleteDramaAsset: (kind: DramaAssetKind, id: string) => void;
  updateDramaAssetFields: (
    kind: DramaAssetKind,
    id: string,
    patch: Partial<Pick<DramaAsset, 'summary' | 'visualNotes' | 'storyRole' | 'name'>>,
  ) => void;
  clearDramaAssetsByKind: (kind: DramaAssetKind) => void;
  /** 绑定画布图像节点 */
  bindDramaAssetImage: (
    kind: DramaAssetKind,
    id: string,
    imageNodeId: string,
    imageUrl?: string,
  ) => void;
  unbindDramaAssetImage: (kind: DramaAssetKind, id: string) => void;
  /** 图像生成成功后：按 imageNodeId / dramaAssetId 回写 imageUrl */
  syncDramaAssetImageFromNode: (imageNodeId: string, imageUrl: string) => void;
  /**
   * 从资产创建图像节点并填入定妆/场景/道具 prompt，自动绑定。
   * 返回新节点 id；失败返回 null。
   */
  createImageNodeFromDramaAsset: (kind: DramaAssetKind, id: string) => string | null;
  loadGlobalCharacters: () => Promise<void>;
  saveCharacterCard: (
    scope: CharacterLibraryScope,
    character: DramaCharacter,
  ) => Promise<boolean>;
  addCharacterReferenceImage: (
    scope: CharacterLibraryScope,
    characterId: string,
    reference: CharacterReferenceImage,
    options?: { makePrimary?: boolean },
  ) => Promise<boolean>;
  setCharacterAvatar: (
    scope: CharacterLibraryScope,
    characterId: string,
    referenceImageId: string,
    crop: CharacterCropRect,
  ) => Promise<boolean>;
  copyCharacterToGlobal: (characterId: string) => Promise<string | null>;
  copyGlobalCharacterToProject: (characterId: string) => string | null;
  deleteGlobalCharacter: (characterId: string) => Promise<boolean>;
  clearGlobalCharacters: () => Promise<boolean>;
  captureImageNodeToCharacter: (
    input: CaptureImageNodeToCharacterInput,
  ) => Promise<CaptureImageNodeToCharacterResult | null>;
  createImageNodeFromCharacterReference: (
    scope: CharacterLibraryScope,
    characterId: string,
    referenceImageId: string,
  ) => string | null;
}

export function countUnreadDramaAssets(library: DramaAssetLibrary): number {
  if (library.lastViewedAt === undefined) return 0;
  const { lastViewedAt } = library;
  return [...library.characters, ...library.scenes, ...library.props]
    .filter((asset) => asset.createdAt > lastViewedAt).length;
}

function patchList<T extends { id: string; updatedAt: number }>(
  list: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return list.map((item) =>
    item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
  );
}

function mapKindList(
  lib: DramaAssetLibrary,
  kind: DramaAssetKind,
  mapper: (list: DramaAsset[]) => DramaAsset[],
): DramaAssetLibrary {
  if (kind === 'character') {
    return { ...lib, characters: mapper(lib.characters) as DramaAssetLibrary['characters'] };
  }
  if (kind === 'scene') {
    return { ...lib, scenes: mapper(lib.scenes) as DramaAssetLibrary['scenes'] };
  }
  return { ...lib, props: mapper(lib.props) as DramaAssetLibrary['props'] };
}

function silentSave(get: () => AppState) {
  void get().saveCurrentProjectSilent?.();
}

function upsertCharacterReference(
  character: DramaCharacter,
  reference: CharacterReferenceImage,
  makePrimary: boolean,
): DramaCharacter {
  const references = [...(character.referenceImages ?? [])];
  const existingIndex = references.findIndex((item) =>
    item.id === reference.id
    || Boolean(reference.sourceNodeId && item.sourceNodeId === reference.sourceNodeId),
  );
  const persistedReference = existingIndex >= 0
    ? { ...references[existingIndex], ...reference, id: references[existingIndex].id }
    : reference;
  if (existingIndex >= 0) references[existingIndex] = persistedReference;
  else references.push(persistedReference);
  return normalizeDramaCharacter({
    ...character,
    referenceImages: references,
    primaryReferenceImageId: makePrimary || !character.primaryReferenceImageId
      ? persistedReference.id
      : character.primaryReferenceImageId,
    imageNodeId: makePrimary || !character.imageNodeId
      ? persistedReference.sourceNodeId
      : character.imageNodeId,
    imageUrl: makePrimary || !character.imageUrl
      ? persistedReference.imageUrl
      : character.imageUrl,
    updatedAt: Date.now(),
  });
}

function cloneCharacter(character: DramaCharacter): DramaCharacter {
  const now = Date.now();
  return normalizeDramaCharacter({
    ...character,
    id: `character-${generateId()}`,
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    referenceImages: (character.referenceImages ?? []).map((reference) => ({
      ...reference,
      sourceNodeId: undefined,
      createdAt: now,
      updatedAt: now,
    })),
    imageNodeId: undefined,
  });
}

function pickSpawnPosition(nodes: Node<BaseNodeData>[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 120, y: 120 };
  let maxX = 0;
  let yAtMax = 120;
  for (const n of nodes) {
    const w = (n.data?.nodeWidth as number) || 280;
    const right = n.position.x + w;
    if (right > maxX) {
      maxX = right;
      yAtMax = n.position.y;
    }
  }
  return { x: maxX + 80, y: yAtMax };
}

export const createDramaAssetsSlice: StateCreator<AppState, [], [], DramaAssetsSlice> = (set, get) => ({
  dramaAssets: emptyDramaAssetLibrary(),
  globalCharacters: [],
  globalCharactersLoading: false,
  dramaAssetsPanelOpen: false,

  setDramaAssetsPanelOpen: (open) => set(open
    ? {
        dramaAssetsPanelOpen: true,
        assetsPanelOpen: true,
        characterLibraryOpen: false,
        historyPanelOpen: false,
        settingsOpen: false,
        chatOpen: false,
      }
    : { dramaAssetsPanelOpen: false }),

  markDramaAssetsViewed: () => {
    set((state) => ({
      dramaAssets: { ...state.dramaAssets, lastViewedAt: Date.now() },
    }));
    silentSave(get);
  },

  setDramaAssets: (library) => set({ dramaAssets: library ?? emptyDramaAssetLibrary() }),

  resetDramaAssets: () => set({ dramaAssets: emptyDramaAssetLibrary() }),

  mergeDramaExtract: (parsed, meta) => {
    const previous = get().dramaAssets;
    const existingAssets = [
      ...previous.characters,
      ...previous.scenes,
      ...previous.props,
    ];
    const legacyBaseline = existingAssets.reduce(
      (latest, asset) => Math.max(latest, asset.createdAt),
      0,
    );
    const next = {
      ...mergeDramaExtractIntoLibrary(previous, parsed, meta),
      lastViewedAt: previous.lastViewedAt ?? legacyBaseline,
    };
    set({ dramaAssets: next });
    silentSave(get);
    // 提取成功后自动打开面板，避免用户找不到入口
    const total =
      next.characters.length + next.scenes.length + next.props.length;
    if (total > 0) {
      get().setDramaAssetsPanelOpen(true);
    }
  },

  confirmDramaAsset: (kind, id, confirmed = true) => {
    const lib = get().dramaAssets;
    set({
      dramaAssets: mapKindList(lib, kind, (list) =>
        patchList(list, id, { confirmed } as Partial<DramaAsset>),
      ),
    });
    silentSave(get);
  },

  deleteDramaAsset: (kind, id) => {
    const lib = get().dramaAssets;
    if (kind === 'character') {
      get().releaseCharacterLibraryNodes('project', id);
      set({ dramaAssets: { ...lib, characters: lib.characters.filter((c) => c.id !== id) } });
    } else if (kind === 'scene') {
      set({ dramaAssets: { ...lib, scenes: lib.scenes.filter((c) => c.id !== id) } });
    } else {
      set({ dramaAssets: { ...lib, props: lib.props.filter((c) => c.id !== id) } });
    }
    silentSave(get);
  },

  updateDramaAssetFields: (kind, id, patch) => {
    const lib = get().dramaAssets;
    // 改名时同步 key，保证后续重提取 merge 仍能对上
    const nextPatch: Partial<DramaAsset> = { ...patch };
    if (typeof patch.name === 'string' && patch.name.trim()) {
      nextPatch.key = normalizeAssetKey(patch.name);
    }
    set({
      dramaAssets: mapKindList(lib, kind, (list) =>
        patchList(list, id, nextPatch),
      ),
    });
    silentSave(get);
  },

  clearDramaAssetsByKind: (kind) => {
    const lib = get().dramaAssets;
    if (kind === 'character') {
      get().releaseCharacterLibraryNodes('project');
      set({ dramaAssets: { ...lib, characters: [] } });
    }
    else if (kind === 'scene') set({ dramaAssets: { ...lib, scenes: [] } });
    else set({ dramaAssets: { ...lib, props: [] } });
    silentSave(get);
  },

  bindDramaAssetImage: (kind, id, imageNodeId, imageUrl) => {
    const lib = get().dramaAssets;
    const node = get().nodes.find((n) => n.id === imageNodeId);
    const resolvedUrl =
      imageUrl
      || (node?.data?.imageUrl as string | undefined)
      || (node?.data?.thumbnailUrl as string | undefined);
    set({
      dramaAssets: mapKindList(lib, kind, (list) =>
        patchList(list, id, {
          imageNodeId,
          imageUrl: resolvedUrl,
        } as Partial<DramaAsset>),
      ),
    });
    if (kind === 'character') {
      const prompt = typeof node?.data?.prompt === 'string' ? node.data.prompt : '';
      void get().addCharacterReferenceImage('project', id, {
        id: `reference-${generateId()}`,
        kind: 'primary',
        assetId: node?.data?.assetId as string | undefined,
        relativePath: node?.data?.relativePath as string | undefined,
        imageUrl: resolvedUrl,
        sourceNodeId: imageNodeId,
        prompt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { makePrimary: true });
      return;
    }
    silentSave(get);
  },

  unbindDramaAssetImage: (kind, id) => {
    const lib = get().dramaAssets;
    const strip = (list: DramaAsset[]): DramaAsset[] =>
      list.map((item) => {
        if (item.id !== id) return item;
        const rest = { ...item };
        delete rest.imageNodeId;
        delete rest.imageUrl;
        return item.kind === 'character'
          ? {
              ...rest,
              referenceImages: [],
              primaryReferenceImageId: undefined,
              avatarReferenceImageId: undefined,
              avatarCrop: undefined,
              updatedAt: Date.now(),
            } as DramaAsset
          : { ...rest, updatedAt: Date.now() } as DramaAsset;
      });
    set({ dramaAssets: mapKindList(lib, kind, strip) });
    silentSave(get);
  },

  syncDramaAssetImageFromNode: (imageNodeId, imageUrl) => {
    const lib = get().dramaAssets;
    let changed = false;

    const syncList = <T extends DramaAsset>(list: T[]): T[] =>
      list.map((item) => {
        const matchingReference = item.kind === 'character'
          ? item.referenceImages?.find((reference) => reference.sourceNodeId === imageNodeId)
          : undefined;
        if (item.imageNodeId === imageNodeId || matchingReference) {
          if (item.imageUrl === imageUrl && matchingReference?.imageUrl === imageUrl) return item;
          changed = true;
          return {
            ...item,
            imageUrl: item.imageNodeId === imageNodeId ? imageUrl : item.imageUrl,
            ...(item.kind === 'character' ? {
              referenceImages: (item.referenceImages ?? []).map((reference) =>
                reference.sourceNodeId === imageNodeId
                  ? { ...reference, imageUrl, updatedAt: Date.now() }
                  : reference,
              ),
            } : {}),
            updatedAt: Date.now(),
          };
        }
        return item;
      });

    const next: DramaAssetLibrary = {
      ...lib,
      characters: syncList(lib.characters),
      scenes: syncList(lib.scenes),
      props: syncList(lib.props),
    };

    // 按节点 data.dramaAssetId 补绑（一键创建路径兜底）
    const node = get().nodes.find((n) => n.id === imageNodeId);
    const dramaAssetId = node?.data?.dramaAssetId as string | undefined;
    const dramaAssetKind = node?.data?.dramaAssetKind as DramaAssetKind | undefined;
    if (dramaAssetId && dramaAssetKind) {
      const asset = findDramaAssetByKind(next, dramaAssetKind, dramaAssetId);
      if (asset && (asset.imageNodeId !== imageNodeId || asset.imageUrl !== imageUrl)) {
        changed = true;
        const bindPatch = { imageNodeId, imageUrl, updatedAt: Date.now() };
        if (dramaAssetKind === 'character') {
          next.characters = next.characters.map((c) =>
            c.id === dramaAssetId ? { ...c, ...bindPatch } : c,
          );
        } else if (dramaAssetKind === 'scene') {
          next.scenes = next.scenes.map((c) =>
            c.id === dramaAssetId ? { ...c, ...bindPatch } : c,
          );
        } else {
          next.props = next.props.map((c) =>
            c.id === dramaAssetId ? { ...c, ...bindPatch } : c,
          );
        }
      }
    }

    if (!changed) return;
    set({ dramaAssets: next });
    silentSave(get);
  },

  createImageNodeFromDramaAsset: (kind, id) => {
    const asset = findDramaAssetByKind(get().dramaAssets, kind, id);
    if (!asset) {
      get().showToast?.('未找到该资产', 'error');
      return null;
    }

    const purpose = defaultPurposeForKind(kind);
    const prompt = buildDramaAssetImagePrompt(asset, purpose);
    const nodeId = `node-${generateId()}`;
    const pos = pickSpawnPosition(get().nodes as Node<BaseNodeData>[]);
    const aspectRatio = defaultAspectRatioForAsset(kind);
    const label = `${asset.name} · ${purposeLabel(purpose)}`;

    // 粗算节点高度
    const nodeWidth = 280;
    const ratioParts = aspectRatio.split(':').map(Number);
    const ar = ratioParts[0] && ratioParts[1] ? ratioParts[0] / ratioParts[1] : 1;
    const nodeHeight = Math.max(160, Math.round((nodeWidth - 4) / ar) + 4);

    const newNode: Node<BaseNodeData> = {
      id: nodeId,
      type: 'ai-image',
      position: pos,
      data: {
        label,
        type: 'ai-image',
        role: 'generator',
        prompt,
        status: 'idle',
        aspectRatio,
        imageSize: '2K',
        nodeWidth,
        nodeHeight,
        dramaAssetId: asset.id,
        dramaAssetKind: kind,
      },
    };

    // 回填本地偏好模型（与侧栏添加图像节点一致）
    try {
      const raw = localStorage.getItem('canvas-model-prefs');
      if (raw) {
        const prefs: Record<string, string> = JSON.parse(raw);
        const modelValue = prefs['ai-image'];
        if (modelValue && modelValue.includes('::')) {
          const [provider, model] = modelValue.split('::');
          if (provider && model) {
            newNode.data.provider = provider;
            newNode.data.model = model;
          }
        }
      }
    } catch { /* ignore */ }

    get().addNode(newNode);
    get().bindDramaAssetImage(kind, id, nodeId);
    get().setAssetsPanelOpen(false);
    get().setSelectedNodeIds([nodeId]);
    get().showToast(`已创建「${label}」图像节点，可直接生成`);

    return nodeId;
  },

  loadGlobalCharacters: async () => {
    set({ globalCharactersLoading: true });
    try {
      set({ globalCharacters: await loadGlobalCharacterCards() });
    } catch {
      get().showToast?.('全局角色加载失败', 'error');
    } finally {
      set({ globalCharactersLoading: false });
    }
  },

  saveCharacterCard: async (scope, character) => {
    const normalized = normalizeDramaCharacter(character);
    if (scope === 'project') {
      const current = get().dramaAssets;
      const exists = current.characters.some((item) => item.id === normalized.id);
      set({
        dramaAssets: {
          ...current,
          characters: exists
            ? current.characters.map((item) => item.id === normalized.id ? normalized : item)
            : [...current.characters, normalized],
        },
      });
      silentSave(get);
      return true;
    }
    try {
      const persisted = await saveGlobalCharacterCard(normalized);
      set((state) => ({
        globalCharacters: state.globalCharacters.some((item) => item.id === persisted.id)
          ? state.globalCharacters.map((item) => item.id === persisted.id ? persisted : item)
          : [persisted, ...state.globalCharacters],
      }));
      return true;
    } catch {
      get().showToast?.('全局角色保存失败', 'error');
      return false;
    }
  },

  addCharacterReferenceImage: async (scope, characterId, reference, options) => {
    const characters = scope === 'project'
      ? get().dramaAssets.characters
      : get().globalCharacters;
    const character = characters.find((item) => item.id === characterId);
    if (!character) return false;
    const next = upsertCharacterReference(character, reference, options?.makePrimary === true);
    return get().saveCharacterCard(scope, next);
  },

  setCharacterAvatar: async (scope, characterId, referenceImageId, crop) => {
    const characters = scope === 'project'
      ? get().dramaAssets.characters
      : get().globalCharacters;
    const character = characters.find((item) => item.id === characterId);
    if (!character?.referenceImages?.some((reference) => reference.id === referenceImageId)) {
      return false;
    }
    return get().saveCharacterCard(scope, normalizeDramaCharacter({
      ...character,
      avatarReferenceImageId: referenceImageId,
      avatarCrop: crop,
      updatedAt: Date.now(),
    }));
  },

  copyCharacterToGlobal: async (characterId) => {
    const character = get().dramaAssets.characters.find((item) => item.id === characterId);
    if (!character) return null;
    const copy = cloneCharacter(character);
    return await get().saveCharacterCard('global', copy) ? copy.id : null;
  },

  copyGlobalCharacterToProject: (characterId) => {
    const character = get().globalCharacters.find((item) => item.id === characterId);
    if (!character) return null;
    const copy = cloneCharacter(character);
    void get().saveCharacterCard('project', copy);
    return copy.id;
  },

  deleteGlobalCharacter: async (characterId) => {
    try {
      await deleteGlobalCharacterCard(characterId);
      set((state) => ({
        globalCharacters: state.globalCharacters.filter((item) => item.id !== characterId),
      }));
      get().releaseCharacterLibraryNodes('global', characterId);
      return true;
    } catch {
      get().showToast?.('全局角色删除失败', 'error');
      return false;
    }
  },

  clearGlobalCharacters: async () => {
    try {
      await clearGlobalCharacterCards();
      set({ globalCharacters: [] });
      get().releaseCharacterLibraryNodes('global');
      return true;
    } catch {
      get().showToast?.('全局角色清空失败', 'error');
      return false;
    }
  },

  captureImageNodeToCharacter: async (input) => {
    const initialState = get();
    const sourceNode = initialState.nodes.find((node) => node.id === input.nodeId);
    if (!sourceNode || !isEligibleCharacterReferenceNode(sourceNode)) {
      initialState.showToast?.('该节点没有可用的角色图片', 'error');
      return null;
    }
    const projectId = initialState.currentProjectId;
    if (!projectId) return null;

    const characters = input.scope === 'project'
      ? initialState.dramaAssets.characters
      : initialState.globalCharacters;
    const baseCharacter = input.characterId
      ? characters.find((character) => character.id === input.characterId)
      : input.newCharacter;
    if (!baseCharacter) {
      initialState.showToast?.('请选择角色', 'error');
      return null;
    }

    const previousLink = sourceNode.data.characterLibraryLinks?.find((link) => (
      link.scope === input.scope && link.characterId === baseCharacter.id
    ));
    const previousReference = baseCharacter.referenceImages?.find((reference) => (
      reference.id === previousLink?.referenceImageId
      || (input.scope === 'project' && reference.sourceNodeId === sourceNode.id)
    ));
    const now = Date.now();
    const reference: CharacterReferenceImage = {
      id: previousReference?.id ?? `reference-${generateId()}`,
      kind: input.kind,
      assetId: sourceNode.data.assetId,
      relativePath: sourceNode.data.relativePath,
      imageUrl: sourceNode.data.imageUrl ?? sourceNode.data.thumbnailUrl,
      sourceNodeId: sourceNode.id,
      prompt: input.prompt,
      createdAt: previousReference?.createdAt ?? now,
      updatedAt: now,
    };
    const nextCharacter = upsertCharacterReference(
      baseCharacter,
      reference,
      !baseCharacter.primaryReferenceImageId || input.kind === 'primary',
    );

    if (input.scope === 'project') {
      const previousLibrary = initialState.dramaAssets;
      const exists = previousLibrary.characters.some((item) => item.id === nextCharacter.id);
      set({
        dramaAssets: {
          ...previousLibrary,
          characters: exists
            ? previousLibrary.characters.map((item) => item.id === nextCharacter.id ? nextCharacter : item)
            : [...previousLibrary.characters, nextCharacter],
        },
      });
      const persistedProjectId = await get().saveCurrentProjectSilent();
      if (!persistedProjectId) {
        if (get().currentProjectId === projectId) set({ dramaAssets: previousLibrary });
        get().showToast?.('角色保存失败，画布节点保持显示', 'error');
        return null;
      }
    } else {
      try {
        const persisted = await saveGlobalCharacterCard(nextCharacter);
        set((state) => ({
          globalCharacters: state.globalCharacters.some((item) => item.id === persisted.id)
            ? state.globalCharacters.map((item) => item.id === persisted.id ? persisted : item)
            : [persisted, ...state.globalCharacters],
        }));
      } catch {
        get().showToast?.('全局角色保存失败，画布节点保持显示', 'error');
        return null;
      }
    }

    if (get().currentProjectId === projectId && get().nodes.some((node) => node.id === sourceNode.id)) {
      const link: CharacterLibraryNodeLink = {
        scope: input.scope,
        characterId: nextCharacter.id,
        referenceImageId: reference.id,
      };
      const linked = get().linkNodeToCharacter(sourceNode.id, link, input.hideNode);
      if (linked) void get().saveCurrentProjectSilent();
    }
    return { characterId: nextCharacter.id, referenceImageId: reference.id };
  },

  createImageNodeFromCharacterReference: (scope, characterId, referenceImageId) => {
    const state = get();
    const characters = scope === 'project'
      ? state.dramaAssets.characters
      : state.globalCharacters;
    const character = characters.find((item) => item.id === characterId);
    const reference = character?.referenceImages?.find((item) => item.id === referenceImageId);
    if (!character || !reference?.imageUrl) {
      state.showToast?.('参考图不可用', 'error');
      return null;
    }
    const linkedNode = state.nodes.find((node) => (
      node.id === reference.sourceNodeId
      || node.data.characterLibraryLinks?.some((link) => (
        link.scope === scope
        && link.characterId === characterId
        && link.referenceImageId === referenceImageId
      ))
    ));
    if (linkedNode) return linkedNode.id;

    const nodeId = `node-${generateId()}`;
    const link: CharacterLibraryNodeLink = { scope, characterId, referenceImageId };
    state.addNode({
      id: nodeId,
      type: 'source-image',
      position: pickSpawnPosition(state.nodes as Node<BaseNodeData>[]),
      data: {
        label: `${character.name} · 参考图`,
        type: 'source-image',
        role: 'source',
        status: 'success',
        prompt: reference.prompt,
        imageUrl: reference.imageUrl,
        thumbnailUrl: reference.imageUrl,
        assetId: reference.assetId,
        relativePath: reference.relativePath,
        nodeWidth: 280,
        nodeHeight: 280,
        characterLibraryLinks: [link],
      },
    });
    if (scope === 'project') {
      void state.addCharacterReferenceImage('project', characterId, {
        ...reference,
        sourceNodeId: nodeId,
        updatedAt: Date.now(),
      });
    }
    return nodeId;
  },
});

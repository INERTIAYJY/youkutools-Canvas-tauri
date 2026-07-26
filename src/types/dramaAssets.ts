/**
 * 短剧资产提取 — 人物 / 场景 / 道具（简介级）
 * 详见 doc/plans/2026-07-20-drama-asset-extract-schema.md
 */

export type DramaAssetKind = 'character' | 'scene' | 'prop';
export type DramaAssetImportance = 'main' | 'supporting' | 'minor';
export type DramaAssetSource = 'ai' | 'manual' | 'merge';

export type CharacterReferenceKind =
  | 'primary'
  | 'avatar'
  | 'full_body'
  | 'expression'
  | 'turnaround'
  | 'outfit'
  | 'other';

/** 头像裁剪区域，坐标与尺寸均为相对原图的 0-1 值。 */
export interface CharacterCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterReferenceImage {
  id: string;
  kind: CharacterReferenceKind;
  assetId?: string;
  relativePath?: string;
  imageUrl?: string;
  /** 仅项目角色可关联来源节点；全局角色不得依赖该字段。 */
  sourceNodeId?: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface DramaAssetBase {
  id: string;
  name: string;
  key: string;
  summary: string;
  visualNotes: string;
  storyRole?: string;
  importance: DramaAssetImportance;
  firstSeen?: string;
  appearances?: string[];
  imageNodeId?: string;
  imageUrl?: string;
  confirmed: boolean;
  createdAt: number;
  updatedAt: number;
  source: DramaAssetSource;
}

export interface DramaCharacter extends DramaAssetBase {
  kind: 'character';
  aliases?: string[];
  identity: string;
  ageBand?: string;
  gender?: string;
  personality?: string;
  relationships?: Array<{ targetName: string; relation: string }>;
  wardrobeDefault?: string;
  referenceImages?: CharacterReferenceImage[];
  primaryReferenceImageId?: string;
  avatarReferenceImageId?: string;
  avatarCrop?: CharacterCropRect;
}

export interface DramaScene extends DramaAssetBase {
  kind: 'scene';
  placeType?: string;
  timeOfDay?: string;
  atmosphere?: string;
  spatialNotes?: string;
}

export interface DramaProp extends DramaAssetBase {
  kind: 'prop';
  ownerName?: string;
  category?: string;
  significance?: string;
}

export type DramaAsset = DramaCharacter | DramaScene | DramaProp;

/** 模型提取响应（未补客户端字段前） */
export interface DramaExtractModelResponse {
  kind: DramaAssetKind;
  items: Array<Record<string, unknown>>;
  notes?: string;
}

export interface DramaExtractMeta {
  at: number;
  sourceNodeId?: string;
  scopeNote?: string;
  modelId?: string;
  kinds: DramaAssetKind[];
}

export interface DramaAssetLibrary {
  version: 2;
  lastExtract?: DramaExtractMeta;
  /** 用户最近一次打开资产管理「短剧资产」页签的时间。 */
  lastViewedAt?: number;
  characters: DramaCharacter[];
  scenes: DramaScene[];
  props: DramaProp[];
}

export const DRAMA_ASSET_KIND_LABEL: Record<DramaAssetKind, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
};

/** 提示词中的标记，生成完成后用于识别并格式化输出 */
export const DRAMA_EXTRACT_MARKER: Record<DramaAssetKind, string> = {
  character: '[[DRAMA_EXTRACT:character]]',
  scene: '[[DRAMA_EXTRACT:scene]]',
  prop: '[[DRAMA_EXTRACT:prop]]',
};

export function emptyDramaAssetLibrary(): DramaAssetLibrary {
  return { version: 2, characters: [], scenes: [], props: [] };
}

const CHARACTER_REFERENCE_KINDS = new Set<CharacterReferenceKind>([
  'primary',
  'avatar',
  'full_body',
  'expression',
  'turnaround',
  'outfit',
  'other',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeCropRect(value: unknown): CharacterCropRect | undefined {
  const crop = asRecord(value);
  if (!crop) return undefined;
  const clamp = (number: number) => Math.min(1, Math.max(0, number));
  const x = clamp(finiteNumber(crop.x, 0));
  const y = clamp(finiteNumber(crop.y, 0));
  const width = clamp(finiteNumber(crop.width, 1));
  const height = clamp(finiteNumber(crop.height, 1));
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: Math.min(x, 1 - width),
    y: Math.min(y, 1 - height),
    width,
    height,
  };
}

function normalizeReferenceImage(
  value: unknown,
  characterId: string,
  index: number,
  fallbackTime: number,
): CharacterReferenceImage | null {
  const reference = asRecord(value);
  if (!reference) return null;
  const imageUrl = typeof reference.imageUrl === 'string' ? reference.imageUrl : undefined;
  const assetId = typeof reference.assetId === 'string' ? reference.assetId : undefined;
  const relativePath = typeof reference.relativePath === 'string' ? reference.relativePath : undefined;
  const sourceNodeId = typeof reference.sourceNodeId === 'string' ? reference.sourceNodeId : undefined;
  if (!imageUrl && !assetId && !relativePath && !sourceNodeId) return null;
  const rawKind = typeof reference.kind === 'string' ? reference.kind : '';
  const kind = CHARACTER_REFERENCE_KINDS.has(rawKind as CharacterReferenceKind)
    ? rawKind as CharacterReferenceKind
    : 'other';
  return {
    id: typeof reference.id === 'string' && reference.id.trim()
      ? reference.id
      : `ref-${characterId}-${index}`,
    kind,
    assetId,
    relativePath,
    imageUrl,
    sourceNodeId,
    prompt: typeof reference.prompt === 'string' ? reference.prompt : '',
    createdAt: finiteNumber(reference.createdAt, fallbackTime),
    updatedAt: finiteNumber(reference.updatedAt, fallbackTime),
  };
}

export function normalizeDramaCharacter(character: DramaCharacter): DramaCharacter {
  const rawReferences = Array.isArray(character.referenceImages)
    ? character.referenceImages
    : [];
  const referenceImages = rawReferences
    .map((reference, index) => normalizeReferenceImage(
      reference,
      character.id,
      index,
      character.updatedAt || character.createdAt,
    ))
    .filter((reference): reference is CharacterReferenceImage => reference !== null);

  if (referenceImages.length === 0 && (character.imageNodeId || character.imageUrl)) {
    referenceImages.push({
      id: `ref-${character.id}-legacy`,
      kind: 'primary',
      imageUrl: character.imageUrl,
      sourceNodeId: character.imageNodeId,
      prompt: '',
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    });
  }

  const referenceIds = new Set(referenceImages.map((reference) => reference.id));
  const primaryReferenceImageId = character.primaryReferenceImageId
    && referenceIds.has(character.primaryReferenceImageId)
    ? character.primaryReferenceImageId
    : referenceImages[0]?.id;
  const avatarReferenceImageId = character.avatarReferenceImageId
    && referenceIds.has(character.avatarReferenceImageId)
    ? character.avatarReferenceImageId
    : referenceImages.find((reference) => reference.kind === 'avatar')?.id;

  return {
    ...character,
    referenceImages,
    primaryReferenceImageId,
    avatarReferenceImageId,
    avatarCrop: avatarReferenceImageId ? normalizeCropRect(character.avatarCrop) : undefined,
  };
}

/** 将持久化的旧版或部分损坏数据收敛为当前可用的 v2 结构。 */
export function normalizeDramaAssetLibrary(value: unknown): DramaAssetLibrary {
  const library = asRecord(value);
  if (!library) return emptyDramaAssetLibrary();
  const characters = Array.isArray(library.characters)
    ? (library.characters as DramaCharacter[]).map(normalizeDramaCharacter)
    : [];
  const scenes = Array.isArray(library.scenes) ? library.scenes as DramaScene[] : [];
  const props = Array.isArray(library.props) ? library.props as DramaProp[] : [];
  return {
    version: 2,
    lastExtract: asRecord(library.lastExtract)
      ? library.lastExtract as unknown as DramaExtractMeta
      : undefined,
    lastViewedAt: finiteNumber(library.lastViewedAt, 0) || undefined,
    characters,
    scenes,
    props,
  };
}

/** @ 引用短剧资产标记：@drama{id:name} */
export const DRAMA_MENTION_PREFIX = '@drama{';

export function formatDramaMention(id: string, name: string): string {
  return `@drama{${id}:${name}}`;
}

/** 角色多参考图时的选图后缀：`资产id#参考图id`，`#all` 表示拼成一张 */
export const DRAMA_MENTION_MERGE_ALL = 'all';

export function buildDramaMentionId(assetId: string, pick?: string): string {
  return pick ? `${assetId}#${pick}` : assetId;
}

export function parseDramaMentionId(raw: string): {
  assetId: string;
  referenceImageId?: string;
  mergeAll: boolean;
} {
  const separator = raw.indexOf('#');
  if (separator < 0) return { assetId: raw, mergeAll: false };
  const pick = raw.slice(separator + 1);
  return {
    assetId: raw.slice(0, separator),
    referenceImageId: pick === DRAMA_MENTION_MERGE_ALL ? undefined : pick,
    mergeAll: pick === DRAMA_MENTION_MERGE_ALL,
  };
}

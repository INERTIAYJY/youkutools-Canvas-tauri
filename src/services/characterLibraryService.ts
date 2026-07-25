/**
 * characterLibraryService - project-independent character card persistence.
 * Global cards never retain project node links; media files are persisted separately.
 */
import {
  clearGlobalCharacters,
  deleteGlobalCharacter,
  getAssetIndexById,
  getAllGlobalCharacters,
  putGlobalCharacter,
} from './indexedDbService';
import type { CharacterReferenceImage, DramaCharacter } from '../types/dramaAssets';
import { normalizeDramaCharacter } from '../types/dramaAssets';
import {
  getAssetUrlFromPath,
  getGlobalFilesDir,
  identifyAsset,
  isTauriEnv,
  resolveIndexedAssetPath,
  sanitizeFileName,
  saveAssetToPermanent,
  type AssetFileEntry,
} from './fileService';

function detachProjectReference(reference: CharacterReferenceImage): CharacterReferenceImage {
  const persisted = { ...reference };
  delete persisted.sourceNodeId;
  return persisted;
}

export function prepareGlobalCharacter(character: DramaCharacter): DramaCharacter {
  const normalized = normalizeDramaCharacter(character);
  const detached = { ...normalized };
  delete detached.imageNodeId;
  return {
    ...detached,
    referenceImages: (normalized.referenceImages ?? []).map(detachProjectReference),
  };
}

function extensionForReference(reference: CharacterReferenceImage): string {
  const dataMime = reference.imageUrl?.match(/^data:image\/([a-zA-Z0-9.+-]+);/i)?.[1];
  if (dataMime) return dataMime === 'jpeg' ? 'jpg' : dataMime;
  const pathExtension = reference.imageUrl
    ?.split(/[?#]/, 1)[0]
    ?.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
  return pathExtension?.toLowerCase() || 'png';
}

async function persistGlobalReference(
  characterName: string,
  reference: CharacterReferenceImage,
): Promise<CharacterReferenceImage> {
  const detached = detachProjectReference(reference);
  if (!isTauriEnv()) return detached;

  const existing = reference.assetId
    ? await getAssetIndexById(reference.assetId)
    : undefined;
  if (existing?.source === 'global') {
    return {
      ...detached,
      relativePath: existing.relativePath,
      imageUrl: await getAssetUrlFromPath(existing.path),
    };
  }

  const sourcePath = reference.assetId
    ? await resolveIndexedAssetPath(reference.assetId)
    : null;
  const fileName = sanitizeFileName(
    `${characterName}-${reference.kind}-${reference.id}.${extensionForReference(reference)}`,
  );
  const entry: AssetFileEntry = {
    assetId: reference.assetId,
    name: sourcePath?.split(/[\\/]/).pop() || fileName,
    path: sourcePath || `virtual://character-reference/${reference.id}`,
    assetUrl: reference.imageUrl,
    size: 0,
    category: 'image',
    availability: 'online',
    source: sourcePath ? 'project' : undefined,
  };
  const savedPath = await saveAssetToPermanent(entry);
  if (!savedPath) {
    throw new Error(`角色参考图 ${reference.id} 保存失败`);
  }
  const globalDir = await getGlobalFilesDir();
  if (!globalDir) throw new Error('全局资产目录不可用');
  const identity = await identifyAsset(savedPath, {
    rootPath: globalDir,
    source: 'global',
  });
  return {
    ...detached,
    assetId: identity.assetId,
    relativePath: identity.relativePath,
    imageUrl: await getAssetUrlFromPath(savedPath),
  };
}

async function persistGlobalReferences(character: DramaCharacter): Promise<DramaCharacter> {
  const references: CharacterReferenceImage[] = [];
  for (const reference of character.referenceImages ?? []) {
    references.push(await persistGlobalReference(character.name, reference));
  }
  return { ...character, referenceImages: references };
}

export async function loadGlobalCharacterCards(): Promise<DramaCharacter[]> {
  const characters = await getAllGlobalCharacters();
  return characters
    .map((character) => prepareGlobalCharacter(character))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

export async function saveGlobalCharacterCard(character: DramaCharacter): Promise<DramaCharacter> {
  const persisted = await persistGlobalReferences(prepareGlobalCharacter(character));
  await putGlobalCharacter(persisted);
  return persisted;
}

export async function deleteGlobalCharacterCard(id: string): Promise<void> {
  await deleteGlobalCharacter(id);
}

export async function clearGlobalCharacterCards(): Promise<void> {
  await clearGlobalCharacters();
}

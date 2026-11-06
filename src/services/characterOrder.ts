/**
 * characterOrder — 按资产库顺序排列角色并处理局部拖拽重排。
 */
import type { DramaCharacter } from '../types/dramaAssets';

/** 旧库保留原排序；有手动顺序后，新角色排在已有角色后面。 */
export function sortCharactersForLibrary(characters: DramaCharacter[]): DramaCharacter[] {
  const rank = (character: DramaCharacter) => Number.isFinite(character.libraryOrder)
    ? character.libraryOrder! : Number.POSITIVE_INFINITY;
  return [...characters].sort((left, right) => {
    const difference = rank(left) - rank(right);
    return (Number.isNaN(difference) ? 0 : difference)
      || right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  });
}

/** 搜索结果只交换自己的槽位，隐藏项保持原位；拒绝重复或已经失效的 ID。 */
export function reorderCharacterSubset(characters: DramaCharacter[], ids: string[]): DramaCharacter[] | null {
  const requested = new Set(ids);
  const byId = new Map(characters.map((character) => [character.id, character]));
  if (requested.size !== ids.length || ids.some((id) => !byId.has(id))) return null;
  let cursor = 0;
  return sortCharactersForLibrary(characters).map((character, index) => ({
    ...(requested.has(character.id) ? byId.get(ids[cursor++])! : character),
    libraryOrder: index,
  }));
}

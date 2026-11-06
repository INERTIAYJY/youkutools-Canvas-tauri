/**
 * characterOrder — 回归测试：角色库手动顺序。
 */
import { describe, expect, it } from 'vitest';
import type { DramaCharacter } from '../../src/types/dramaAssets';
import { reorderCharacterSubset, sortCharactersForLibrary } from '../../src/services/characterOrder';

function card(id: string, updatedAt: number, libraryOrder?: number): DramaCharacter {
  return { id, name: id, kind: 'character', key: id, identity: '', summary: '', visualNotes: '',
    importance: 'main', confirmed: false, source: 'manual', createdAt: 1, updatedAt, libraryOrder };
}

describe('角色库手动顺序', () => {
  it('旧数据保留最近修改顺序，不修改输入数组', () => {
    const characters = [card('a', 1), card('b', 2)];
    expect(sortCharactersForLibrary(characters).map((item) => item.id)).toEqual(['b', 'a']);
    expect(characters[0].id).toBe('a');
  });
  it('手动排序后编辑时间不影响位置，新角色追加到末尾', () => {
    expect(sortCharactersForLibrary([card('a', 99, 1), card('new', 100), card('b', 1, 0)])
      .map((item) => item.id)).toEqual(['b', 'a', 'new']);
  });
  it('搜索结果换位时，隐藏项保持原槽位且正文和时间保持原样', () => {
    const characters = [card('a', 4), card('hidden', 3), card('b', 2), card('c', 1)];
    const reordered = reorderCharacterSubset(characters, ['c', 'a', 'b'])!;
    expect(reordered.map((item) => item.id)).toEqual(['c', 'hidden', 'a', 'b']);
    expect(reordered.find((item) => item.id === 'a')).toEqual({ ...characters[0], libraryOrder: 2 });
  });
  it('拒绝重复和失效 ID', () => {
    expect(reorderCharacterSubset([card('a', 1)], ['a', 'a'])).toBeNull();
    expect(reorderCharacterSubset([card('a', 1)], ['deleted'])).toBeNull();
  });
  it('损坏的非有限排序值按旧记录处理', () => {
    expect(sortCharactersForLibrary([card('a', 1, NaN), card('b', 3, Infinity), card('c', 2, 0)])
      .map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });
});

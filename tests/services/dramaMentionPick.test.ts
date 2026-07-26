import { describe, expect, it } from 'vitest';
import {
  DRAMA_MENTION_MERGE_ALL,
  buildDramaMentionId,
  parseDramaMentionId,
} from '../../src/types/dramaAssets';
import { resolveDramaAssetImageRef } from '../../src/services/dramaAssetPrompt';
import type { DramaCharacter } from '../../src/types/dramaAssets';

function character(): DramaCharacter {
  return {
    id: 'char_1',
    kind: 'character',
    key: 'lin',
    name: '林小满',
    createdAt: 0,
    updatedAt: 0,
    primaryReferenceImageId: 'ref-front',
    referenceImages: [
      { id: 'ref-front', kind: 'primary', imageUrl: 'front.png', createdAt: 0 },
      { id: 'ref-side', kind: 'turnaround', imageUrl: 'side.png', createdAt: 0 },
    ],
  } as DramaCharacter;
}

describe('@drama 选图后缀', () => {
  it('不带后缀时保持原样', () => {
    expect(buildDramaMentionId('char_1')).toBe('char_1');
    expect(parseDramaMentionId('char_1')).toEqual({ assetId: 'char_1', mergeAll: false });
  });

  it('往返得到同一个参考图 id', () => {
    const raw = buildDramaMentionId('char_1', 'ref-side');
    expect(raw).toBe('char_1#ref-side');
    expect(parseDramaMentionId(raw)).toEqual({
      assetId: 'char_1',
      referenceImageId: 'ref-side',
      mergeAll: false,
    });
  });

  it('#all 解析为合并且不带具体参考图', () => {
    const raw = buildDramaMentionId('char_1', DRAMA_MENTION_MERGE_ALL);
    expect(parseDramaMentionId(raw)).toEqual({
      assetId: 'char_1',
      referenceImageId: undefined,
      mergeAll: true,
    });
  });
});

describe('resolveDramaAssetImageRef 指定参考图', () => {
  it('不指定时用主视觉', () => {
    expect(resolveDramaAssetImageRef(character(), [])?.imageUrl).toBe('front.png');
  });

  it('指定时用那一张', () => {
    expect(resolveDramaAssetImageRef(character(), [], 'ref-side')?.imageUrl).toBe('side.png');
  });

  it('指定的参考图不存在时回落到主视觉，而不是没有图', () => {
    expect(resolveDramaAssetImageRef(character(), [], 'ref-gone')?.imageUrl).toBe('front.png');
  });
});

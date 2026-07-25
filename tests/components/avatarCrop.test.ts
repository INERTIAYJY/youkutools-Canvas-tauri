import { describe, expect, it } from 'vitest';
import {
  AVATAR_ASPECT,
  avatarCropBase,
} from '../../src/components/character/characterReferencePresentation';

/** 裁剪框在原图上的实际像素宽高比 */
function pixelAspect(imageRatio: number) {
  const { baseWidth, baseHeight } = avatarCropBase(imageRatio);
  return (baseWidth * imageRatio) / baseHeight;
}

describe('avatarCropBase', () => {
  it('横图、竖图、方图裁出来的都是头像框比例', () => {
    for (const imageRatio of [0.3, 9 / 11, 1, 1.78, 4]) {
      expect(pixelAspect(imageRatio)).toBeCloseTo(AVATAR_ASPECT, 6);
    }
  });

  it('裁剪框不超出图片，且贴满其中一条边', () => {
    for (const imageRatio of [0.3, 1, 4]) {
      const { baseWidth, baseHeight } = avatarCropBase(imageRatio);
      expect(baseWidth).toBeLessThanOrEqual(1);
      expect(baseHeight).toBeLessThanOrEqual(1);
      expect(Math.max(baseWidth, baseHeight)).toBeCloseTo(1, 6);
    }
  });
});

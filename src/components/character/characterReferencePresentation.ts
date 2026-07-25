import type {
  CharacterCropRect,
  CharacterReferenceImage,
} from '../../types/dramaAssets';

export const CHARACTER_REFERENCE_KIND_LABELS: Record<CharacterReferenceImage['kind'], string> = {
  primary: '主视觉',
  avatar: '头像',
  full_body: '全身',
  expression: '表情',
  turnaround: '转面',
  outfit: '服装',
  other: '其他',
};

/** 头像框宽高比，裁切编辑器与角色条头像共用，保证裁出来的区域不会被拉伸 */
export const AVATAR_ASPECT = 9 / 11;

/**
 * zoom=1 时的归一化裁剪框：像素宽高比锁定为 AVATAR_ASPECT，并贴满图片的短边。
 * imageRatio 为图片自身的 宽/高。
 */
export function avatarCropBase(imageRatio: number) {
  const shape = AVATAR_ASPECT / imageRatio;
  return shape >= 1
    ? { baseWidth: 1, baseHeight: 1 / shape }
    : { baseWidth: shape, baseHeight: 1 };
}

export function cropImageStyle(crop?: CharacterCropRect) {
  if (!crop) return undefined;
  return {
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${-crop.x / crop.width * 100}%`,
    top: `${-crop.y / crop.height * 100}%`,
  };
}

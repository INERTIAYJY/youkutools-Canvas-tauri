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

export function cropImageStyle(crop?: CharacterCropRect) {
  if (!crop) return undefined;
  return {
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${-crop.x / crop.width * 100}%`,
    top: `${-crop.y / crop.height * 100}%`,
  };
}

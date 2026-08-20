import { describe, expect, it } from 'vitest';
import {
  DREAMINA_IMAGE_MODELS,
  DREAMINA_VIDEO_MODELS,
  getDreaminaVideoCapability,
} from '../../src/services/ai/dreaminaModels';

describe('即梦 CLI 模型能力表', () => {
  it('包含 CLI v1.4.17 的完整图片模型版本', () => {
    expect(DREAMINA_IMAGE_MODELS.map((model) => model.version)).toEqual([
      '3.0',
      '3.1',
      '4.0',
      '4.1',
      '4.5',
      '4.6',
      '4.7',
      '5.0',
      '5.0Pro',
    ]);
    expect(DREAMINA_IMAGE_MODELS.find((model) => model.version === '5.0Pro')?.resolutions)
      .toEqual(['1.5K', '2K', '4K']);
    expect(DREAMINA_IMAGE_MODELS.find((model) => model.version === '3.0')?.supportsImageReference)
      .toBe(false);
  });

  it('包含 CLI v1.4.17 的完整通用视频模型版本', () => {
    expect(DREAMINA_VIDEO_MODELS.map((model) => model.version)).toEqual([
      'seedance2.0',
      'seedance2.0fast',
      'seedance2.0_vip',
      'seedance2.0fast_vip',
      'seedance2.0mini',
      'seedance2.5',
    ]);
  });

  it('准确声明 Seedance 2.5 和 2.0 VIP 的规格', () => {
    expect(getDreaminaVideoCapability('dreamina/seedance2.5')).toMatchObject({
      resolutions: ['480p', '720p', '1080p'],
      minDuration: 4,
      maxDuration: 30,
      maxImageReferences: 30,
      maxVideoReferences: 10,
      maxAudioReferences: 10,
      maxTotalReferences: 50,
      allowsAudioOnly: true,
    });
    expect(getDreaminaVideoCapability('dreamina/seedance2.0_vip')?.resolutions)
      .toEqual(['720p', '1080p', '4k']);
  });
});

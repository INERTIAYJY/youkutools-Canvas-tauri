import { describe, expect, it } from 'vitest';
import { toSeedanceCapabilityView } from '../../src/services/ai/apimartVideoModels';
import type { VideoModelCapability } from '../../src/types/aiTypes';

describe('toSeedanceCapabilityView — 通用视频模型能力声明适配', () => {
  it('未声明能力时返回 undefined（保持通用兜底）', () => {
    expect(toSeedanceCapabilityView(undefined)).toBeUndefined();
  });

  it('声明了时长上限时，按声明约束（如 30s）', () => {
    const capability: VideoModelCapability = { maxDuration: 30, minDuration: 4 };
    const view = toSeedanceCapabilityView(capability);
    expect(view?.maxDuration).toBe(30);
    expect(view?.minDuration).toBe(4);
  });

  it('声明了分辨率档位时，按声明约束（如 480p/720p）', () => {
    const capability: VideoModelCapability = { resolutions: ['480p', '720p'], defaultResolution: '720p' };
    const view = toSeedanceCapabilityView(capability);
    expect(view?.resolutions).toEqual(['480p', '720p']);
    expect(view?.defaultResolution).toBe('720p');
  });

  it('supportsAudio=false 时不启用音频字段，且默认无声', () => {
    const view = toSeedanceCapabilityView({ supportsAudio: false });
    expect(view?.audioField).toBeUndefined();
    expect(view?.defaultAudio).toBe(false);
  });

  it('缺省字段按通用 Seedance 兜底补齐', () => {
    const view = toSeedanceCapabilityView({});
    expect(view?.maxDuration).toBe(15);
    expect(view?.minDuration).toBe(2);
    expect(view?.defaultDuration).toBe(5);
    expect(view?.maxImageReferences).toBe(9);
    expect(view?.maxVideoReferences).toBe(3);
    expect(view?.maxAudioReferences).toBe(3);
    expect(view?.audioField).toBe('generate_audio');
    expect(view?.defaultAudio).toBe(true);
  });
});

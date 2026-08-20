import { describe, expect, it } from 'vitest';
import {
  getVolcengineSeedanceCapability,
  isVolcengineSeedanceModel,
} from '../../src/services/ai/volcengineVideoModels';

describe('volcengine Seedance capability', () => {
  it.each([
    {
      model: 'volcengine/doubao-seedance-2-0-260128',
      modelId: 'doubao-seedance-2-0-260128',
      resolutions: ['480p', '720p', '1080p', '4k'],
    },
    {
      model: 'volcengine/doubao-seedance-2-0-fast-260128',
      modelId: 'doubao-seedance-2-0-fast-260128',
      resolutions: ['480p', '720p'],
    },
    {
      model: 'volcengine/doubao-seedance-2-0-mini-260615',
      modelId: 'doubao-seedance-2-0-mini-260615',
      resolutions: ['480p', '720p'],
    },
  ])('configures $modelId resolutions, ratios and 4-15s duration', ({ model, modelId, resolutions }) => {
    const capability = getVolcengineSeedanceCapability(model);
    expect(capability).toBeDefined();
    expect(capability?.modelId).toBe(modelId);
    expect(capability?.resolutions).toEqual(resolutions);
    expect(capability?.defaultResolution).toBe('720p');
    expect(capability?.ratios).toEqual(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
    expect(capability?.defaultRatio).toBe('16:9');
    expect(capability?.minDuration).toBe(4);
    expect(capability?.maxDuration).toBe(15);
    expect(capability?.maxImageReferences).toBe(9);
    expect(capability?.maxVideoReferences).toBe(3);
    expect(capability?.maxAudioReferences).toBe(3);
  });

  it('resolves Seedance 2.5 with 480p/720p and 4-30s', () => {
    const capability = getVolcengineSeedanceCapability('volcengine/doubao-seedance-2-5-260628');
    expect(capability).toBeDefined();
    expect(capability?.modelId).toBe('doubao-seedance-2-5-260628');
    expect(capability?.resolutions).toEqual(['480p', '720p']);
    expect(capability?.defaultResolution).toBe('720p');
    expect(capability?.minDuration).toBe(4);
    expect(capability?.maxDuration).toBe(30);
    expect(capability?.maxImageReferences).toBe(30);
    expect(capability?.maxVideoReferences).toBe(10);
    expect(capability?.maxAudioReferences).toBe(10);
  });

  it('strips the date suffix for matching and is case-insensitive', () => {
    expect(isVolcengineSeedanceModel('doubao-seedance-2-5-260628')).toBe(true);
    expect(isVolcengineSeedanceModel('volcengine/DouBao-Seedance-2-5-260628')).toBe(true);
    expect(isVolcengineSeedanceModel('doubao-seedance-2-5')).toBe(true);
  });

  it('returns undefined for models without a dedicated capability entry', () => {
    expect(getVolcengineSeedanceCapability('volcengine/doubao-seedance-1-5-pro-251215')).toBeUndefined();
    expect(getVolcengineSeedanceCapability('apimart/doubao-seedance-2.5')).toBeUndefined();
  });
});

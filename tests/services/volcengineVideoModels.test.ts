import { describe, expect, it } from 'vitest';
import {
  getVolcengineSeedanceCapability,
  isVolcengineSeedanceModel,
} from '../../src/services/ai/volcengineVideoModels';

describe('volcengine Seedance capability', () => {
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
    expect(getVolcengineSeedanceCapability('volcengine/doubao-seedance-2-0-260128')).toBeUndefined();
    expect(getVolcengineSeedanceCapability('volcengine/doubao-seedance-1-5-pro-251215')).toBeUndefined();
    expect(getVolcengineSeedanceCapability('apimart/doubao-seedance-2.5')).toBeUndefined();
  });
});

/**
 * volcenginePricing — 回归测试：Volcengine price catalog。
 */
import { describe, expect, it } from 'vitest';
import { quoteVolcengineImage, quoteVolcengineVideo } from '../../src/services/billing/volcenginePricing';
import { sanitizeBillingError } from '../../src/services/billing/volcengineBillingService';

describe('Volcengine price catalog', () => {
  it('separates image models and pixel tiers', () => {
    expect(quoteVolcengineImage({ modelId: 'doubao-seedream-5-0-pro', inputImageCount: 2,
      outputCount: 1, width: 1536, height: 1536 }).amountMicros).toBe(320_000);
    expect(quoteVolcengineImage({ modelId: 'doubao-seedream-5-0-pro', inputImageCount: 0,
      outputCount: 1, width: 2048, height: 2048 }).amountMicros).toBe(600_000);
    expect(quoteVolcengineImage({ modelId: 'doubao-seedream-5-0-lite', inputImageCount: 0,
      outputCount: 3 }).amountMicros).toBe(660_000);
  });

  it('uses separate video-input tariffs when Usage is present', () => {
    const base = { modelId: 'volcengine/doubao-seedance-2-5-260628', durationSeconds: -1,
      resolution: '720p', ratio: 'adaptive', completionTokens: 10_000 };
    expect(quoteVolcengineVideo(base).amountMicros).toBe(700_000);
    expect(quoteVolcengineVideo({ ...base, inputVideoSeconds: 1 }).amountMicros).toBe(420_000);
  });

  it('quotes the dated model ID shown in the video node', () => {
    const quote = quoteVolcengineVideo({ modelId: 'doubao-seedance-2-5-260628',
      durationSeconds: 5, resolution: '720p', ratio: '16:9', fps: 24 });
    expect(quote.amountMicros).toBe(7_560_000);
  });

  it('keeps unknown rules and automatic durations unpriced', () => {
    expect(quoteVolcengineVideo({ modelId: 'unknown', durationSeconds: 5,
      resolution: '720p', ratio: '16:9' }).amountMicros).toBeNull();
    expect(quoteVolcengineVideo({ modelId: 'doubao-seedance-2-5-260628', durationSeconds: -1,
      resolution: '720p', ratio: '16:9' }).amountMicros).toBeNull();
    expect(quoteVolcengineVideo({ modelId: 'doubao-seedance-2-0-fast-260128', durationSeconds: 5,
      resolution: '720p', ratio: '16:9' }).amountMicros).not.toBeNull();
  });

  it('does not persist raw provider error text', () => {
    expect(sanitizeBillingError('HTTP 429: Bearer secret')).toBe('HTTP 429');
    expect(sanitizeBillingError('任务失败: https://private.example/token')).toBe('方舟任务失败');
  });
});

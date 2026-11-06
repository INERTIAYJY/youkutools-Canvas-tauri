/**
 * volcengineImage — 回归测试：Volcengine Seedream image requests。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => ({
  corsSafeFetch: vi.fn(),
}));

vi.mock('../../src/services/ai/httpTransport', () => ({
  corsSafeFetch: transportMocks.corsSafeFetch,
}));

import { generateVolcengineImage } from '../../src/services/ai/providers/volcengineImage';

const baseParams = {
  apiKey: 'ark-key',
  baseUrl: 'https://ark.example/api/v3',
  model: 'volcengine/doubao-seedream-5-0-pro-260628',
  provider: 'volcengine',
  prompt: '生成角色三视图',
  imageSize: '2K',
  aspectRatio: '16:9',
  imageUrls: ['https://cdn.example/reference.png'],
};

function successfulResponse() {
  return {
    ok: true,
    json: async () => ({ data: [{ url: 'https://cdn.example/result.png' }] }),
  };
}

describe('Volcengine Seedream image requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.corsSafeFetch.mockResolvedValue(successfulResponse());
  });

  it('uses the official 2K 16:9 pixel preset for Seedream 5.0 Pro', async () => {
    await expect(generateVolcengineImage(baseParams)).resolves.toEqual({
      url: 'https://cdn.example/result.png',
      width: 2816,
      height: 1584,
    });

    const request = transportMocks.corsSafeFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: '生成角色三视图',
      image: ['https://cdn.example/reference.png'],
      size: '2816x1584',
    });
    expect(body).not.toHaveProperty('sequential_image_generation');
  });

  it('sends only the resolution tier when Seedream 5.0 Pro uses adaptive ratio', async () => {
    await generateVolcengineImage({ ...baseParams, aspectRatio: '自适应' });

    const request = transportMocks.corsSafeFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.size).toBe('2K');
  });

  it('supports the documented 1.5K tier and pixel mapping', async () => {
    await expect(generateVolcengineImage({
      ...baseParams,
      imageSize: '1.5K',
      aspectRatio: '3:2',
    })).resolves.toMatchObject({ width: 1872, height: 1248 });

    const request = transportMocks.corsSafeFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.size).toBe('1872x1248');
  });
});

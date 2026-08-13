import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderModelCatalog } from '../../src/services/ai/providerCatalogService';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('providerCatalogService 模型分类推断', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['MiniMax-H3'],
    ['minimax-h3'],
    ['MiniMax-H3-Context-IR'],
    ['minimax-h3-regeneration'],
    ['MiniMax_H3'],
    ['MiniMax H3'],
  ])('中转站拉取 %s 归类为视频模型', async (modelId) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      data: [
        {
          id: modelId,
          object: 'model',
          created: 0,
          owned_by: 'minimax',
          supported_endpoint_types: ['openai'],
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProviderModelCatalog({
      providerId: 'apimart',
      config: {
        name: 'APIMart',
        apiKey: 'test-key',
        baseUrl: 'https://api.apimart.ai',
        catalogId: 'apimart',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apimart.ai/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.category).toBe('video');
    expect(result.models[0]?.provider).toBe('apimart');
  });

  it('自定义接口拉取 minimax-h3 同样归类为视频模型', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([
      { id: 'MiniMax-H3', object: 'model' },
      { id: 'MiniMax-H3-Context-IR', object: 'model' },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProviderModelCatalog({
      providerId: 'custom-openai',
      config: {
        name: '中转',
        apiKey: 'test-key',
        baseUrl: 'https://relay.example.com/v1',
        catalogId: 'custom-openai',
      },
    });

    expect(result.models.every((model) => model.category === 'video')).toBe(true);
  });

  it('不影响其他模型的分类推断', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([
      { id: 'gpt-4o', object: 'model' },
      { id: 'tts-1', object: 'model' },
      { id: 'dall-e-3', object: 'model' },
      { id: 'minimax-text-01', object: 'model' },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProviderModelCatalog({
      providerId: 'custom-openai',
      config: {
        name: '中转',
        apiKey: 'test-key',
        baseUrl: 'https://relay.example.com/v1',
        catalogId: 'custom-openai',
      },
    });

    const categoryOf = (id: string) => result.models.find((model) => model.id === id)?.category;
    expect(categoryOf('gpt-4o')).toBe('text');
    expect(categoryOf('tts-1')).toBe('audio');
    expect(categoryOf('dall-e-3')).toBe('image');
    expect(categoryOf('minimax-text-01')).toBe('text');
  });
});

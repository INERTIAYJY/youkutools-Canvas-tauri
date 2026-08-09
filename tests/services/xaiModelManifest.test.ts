import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseModelExecutionProtocol,
  previewModelProtocolRequest,
  submitModelProtocol,
  validateModelExecutionProtocol,
} from '../../src/services/ai/modelProtocol';
import { getProviderDefinition } from '../../src/services/ai/providerCatalogService';
import {
  XAI_BASE_URL,
  XAI_MODEL_MANIFEST,
} from '../../src/services/ai/providers/xaiModelManifest';
import type { ModelExecutionProtocol } from '../../src/types/aiTypes';

function protocolFor(modelId: string): ModelExecutionProtocol {
  const profile = XAI_MODEL_MANIFEST.find((model) => model.id === modelId)?.executionProfile;
  if (!profile?.protocol) throw new Error(`模型 ${modelId} 没有自定义协议`);
  return profile.protocol;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('xAI 官方模型清单', () => {
  it('注册独立厂商及文本、图片、视频模型', () => {
    expect(getProviderDefinition('xai')).toMatchObject({
      id: 'xai',
      defaultBaseUrl: XAI_BASE_URL,
      catalogAdapter: 'local-manifest',
      models: XAI_MODEL_MANIFEST,
    });
    expect(XAI_MODEL_MANIFEST.map((model) => [model.id, model.category])).toEqual([
      ['grok-4.5', 'text'],
      ['grok-imagine-image', 'image'],
      ['grok-imagine-image-quality', 'image'],
      ['grok-imagine-video', 'video'],
      ['grok-imagine-video-1.5', 'video'],
    ]);
    expect(XAI_MODEL_MANIFEST[0]?.executionProfile).toEqual({ preset: 'openai-chat' });
  });

  it('所有媒体协议都通过本地 schema 校验', () => {
    for (const model of XAI_MODEL_MANIFEST.filter((item) => item.category !== 'text')) {
      expect(validateModelExecutionProtocol(model.executionProfile?.protocol), model.id).toEqual([]);
    }
  });

  it('渲染官方图片生成请求并解析 URL 响应路径', () => {
    const protocol = protocolFor('grok-imagine-image-quality');
    const request = previewModelProtocolRequest({
      baseUrl: XAI_BASE_URL,
      protocol,
      variables: { model: 'grok-imagine-image-quality', prompt: '夜晚的上海天际线' },
    });

    expect(request).toMatchObject({
      method: 'POST',
      relativeUrl: '/v1/images/generations',
      body: {
        model: 'grok-imagine-image-quality',
        prompt: '夜晚的上海天际线',
        response_format: 'url',
      },
    });
    expect(parseModelExecutionProtocol(protocol).response.result?.urlPath).toBe('data.*.url');
  });

  it('为文生视频和单图生视频生成不同请求体', () => {
    const variables = {
      model: 'grok-imagine-video',
      prompt: '海浪拍打礁石',
      duration: 8,
      aspectRatio: '16:9',
      seedanceResolution: '720p',
      firstImage: 'https://assets.example/start.png',
    };
    const textRequest = previewModelProtocolRequest({
      baseUrl: XAI_BASE_URL,
      protocol: protocolFor('grok-imagine-video'),
      variables,
    });
    const imageRequest = previewModelProtocolRequest({
      baseUrl: XAI_BASE_URL,
      protocol: protocolFor('grok-imagine-video-1.5'),
      variables: { ...variables, model: 'grok-imagine-video-1.5' },
    });

    expect(textRequest.body).not.toHaveProperty('image');
    expect(imageRequest.body).toMatchObject({
      image: { url: 'https://assets.example/start.png' },
    });
  });

  it('从 request_id 构建官方视频轮询地址', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      request_id: 'request-123',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const submitted = await submitModelProtocol({
      apiKey: 'secret',
      baseUrl: XAI_BASE_URL,
      protocol: protocolFor('grok-imagine-video'),
      variables: {
        model: 'grok-imagine-video',
        prompt: '云层中的飞船',
        duration: 6,
        aspectRatio: '16:9',
        seedanceResolution: '720p',
      },
    });

    expect(submitted.taskId).toBe('request-123');
    expect(submitted.poll).toMatchObject({
      method: 'GET',
      url: 'https://api.x.ai/v1/videos/request-123',
      statusPath: 'status',
      successValues: ['done'],
      failureValues: ['failed', 'expired'],
      resultUrlPath: 'video.url',
      intervalMs: 10_000,
    });
  });
});

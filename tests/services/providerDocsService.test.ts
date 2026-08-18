import { describe, expect, it } from 'vitest';
import {
  buildRelayCatalogContent,
  inferRelayModelCategory,
  parseNewApiPricingPayload,
  parseNewApiStatusPayload,
} from '../../src/services/providerDocsService';

describe('new-api relay catalog parsing', () => {
  const pricingBody = JSON.stringify({
    auto_groups: ['default'],
    data: [
      {
        model_name: 'lec-seedance-2-0-full-431-720p',
        display_name: 'Seedance 2.0 满血 431 720p',
        description: 'Seedance 2.0 431 系列视频生成，支持 10 秒或 15 秒视频生成。',
        model_price: 3.5,
        supported_endpoint_types: ['openai-video'],
      },
      {
        model_name: 'lec-ac-image-2',
        display_name: 'Image 2（AC）',
        description: 'Image 2 图像生成与编辑模型。',
        model_price: 0.08,
        supported_endpoint_types: ['image-generation'],
      },
      {
        model_name: 'gpt-4o',
        display_name: 'GPT-4o',
        model_price: 0.1,
        supported_endpoint_types: ['chat', 'completion'],
      },
    ],
  });

  it('parses the public new-api pricing model list', () => {
    const items = parseNewApiPricingPayload(pricingBody);
    expect(items).toHaveLength(3);
    expect(items?.[0].model_name).toBe('lec-seedance-2-0-full-431-720p');
    expect(items?.[1].display_name).toBe('Image 2（AC）');
  });

  it('rejects non-new-api pricing payloads', () => {
    expect(parseNewApiPricingPayload('not json')).toBeNull();
    expect(parseNewApiPricingPayload('{"data":"nope"}')).toBeNull();
    expect(parseNewApiPricingPayload('{"data":[]}')).toBeNull();
    expect(parseNewApiPricingPayload('{"data":[{"id":"x"}]}')).toBeNull();
    expect(parseNewApiPricingPayload('{"data":[{"model_name":""}]}')).toBeNull();
  });

  it('infers model category from endpoint types and identifiers', () => {
    expect(inferRelayModelCategory({ model_name: 'lec-seedance-x', supported_endpoint_types: ['openai-video'] })).toBe('视频');
    expect(inferRelayModelCategory({ model_name: 'lec-ac-image-2', supported_endpoint_types: ['image-generation'] })).toBe('图片');
    expect(inferRelayModelCategory({ model_name: 'tts-1', supported_endpoint_types: ['audio'] })).toBe('音频');
    expect(inferRelayModelCategory({ model_name: 'gpt-4o', supported_endpoint_types: ['chat'] })).toBe('文本');
    expect(inferRelayModelCategory({ model_name: 'flux-pro' })).toBe('图片');
    expect(inferRelayModelCategory({ model_name: 'seedream-x' })).toBe('图片');
  });

  it('parses status payload for system name and announcements', () => {
    const status = JSON.stringify({
      data: {
        system_name: 'Lec API',
        announcements: [{ content: '## 上架' }, { content: '' }],
      },
    });
    const info = parseNewApiStatusPayload(status);
    expect(info?.systemName).toBe('Lec API');
    expect(info?.announcements).toEqual(['## 上架']);
  });

  it('rejects non-new-api status payloads', () => {
    expect(parseNewApiStatusPayload('{"data":{"foo":"bar"}}')).toBeNull();
    expect(parseNewApiStatusPayload('nope')).toBeNull();
  });

  it('builds a readable catalog including model list and announcements', () => {
    const items = parseNewApiPricingPayload(pricingBody)!;
    const status = parseNewApiStatusPayload(JSON.stringify({
      data: { system_name: 'Lec API', announcements: [{ content: '## 上架' }] },
    }));
    const content = buildRelayCatalogContent('https://api.paipu.net/docs', items, status);
    expect(content.title).toBe('Lec API');
    expect(content.text).toContain('模型清单（共 3 个）');
    expect(content.text).toContain('lec-seedance-2-0-full-431-720p');
    expect(content.text).toContain('视频');
    expect(content.text).toContain('站内公告');
    expect(content.text).toContain('## 上架');
    // 字段名必须以各模型自己的文档为准，通用约定只是读不到文档时的兜底
    expect(content.text).toContain('请求体字段务必以该模型自己的文档为准');
    expect(content.text).toContain('400 unsupported field');
    expect(content.text).toContain('/v1/videos');
  });
});

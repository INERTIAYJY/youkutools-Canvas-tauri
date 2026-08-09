import { describe, expect, it } from 'vitest';
import { modelProtocolUsesVariable } from '../../src/services/ai/modelProtocol';
import { analyzeModelProtocolExamples } from '../../src/services/ai/modelProtocolImport';

describe('VideoParamSelector 自定义协议参数识别', () => {
  it('按协议变量识别任意厂商视频模型的比例、分辨率和秒数控件', () => {
    const imported = analyzeModelProtocolExamples({
      submitRequest: `
curl https://api.paipu.net/v1/videos \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "future-provider-video-model",
    "prompt": "cinematic train station",
    "duration": 5,
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }'`,
      submitResponse: '{"id":"task_1","status":"queued"}',
      pollRequest: 'curl https://api.paipu.net/v1/videos/task_1 -H "Authorization: Bearer YOUR_API_KEY"',
      pollResponse: '{"id":"task_1","status":"completed","metadata":{"url":"https://cdn.example/video.mp4"}}',
    });
    const source = JSON.stringify(imported.protocol);

    expect(modelProtocolUsesVariable(source, 'aspectRatio', 'seedanceRatio')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'resolution', 'seedanceResolution')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'duration', 'seedanceDuration')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'videoFrames')).toBe(false);
  });

  it('兼容模板变量花括号内的空格', () => {
    expect(modelProtocolUsesVariable('{"resolution":"{{ seedanceResolution }}"}', 'seedanceResolution'))
      .toBe(true);
  });
});

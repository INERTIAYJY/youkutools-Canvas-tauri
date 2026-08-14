import { describe, expect, it } from 'vitest';
import { buildAudioMusicRequestBody, buildAudioSpeechRequestBody, mapAudioParameters } from '../../src/services/ai/audioParameterMappings';
import { buildStandardImageRequestBody, mapImageParameters } from '../../src/services/ai/imageParameterMappings';
import { buildGenericVideoRequestBody } from '../../src/services/ai/videoParameterMappings';

describe('media parameter mappings', () => {
  it('maps standard image UI fields to OpenAI-compatible fields', () => {
    expect(buildStandardImageRequestBody({
      modelName: 'flux-2-pro',
      prompt: 'cat',
      count: 2,
      size: '1024x1024',
      imageUrls: ['https://example.com/ref.png'],
    })).toEqual({
      model: 'flux-2-pro',
      prompt: 'cat',
      n: 2,
      size: '1024x1024',
      response_format: 'url',
      image_urls: ['https://example.com/ref.png'],
    });
  });

  it('maps provider-specific image field names', () => {
    expect(mapImageParameters('volcengine', 'doubao-seedream-5-0-pro-260628', {
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'cat',
      imageSize: '2K',
      referenceImageUrls: ['https://example.com/ref.png'],
    })).toMatchObject({
      size: '2K',
      image: ['https://example.com/ref.png'],
      watermark: true,
    });
  });

  it('maps video references without exposing provider fields to the caller', () => {
    expect(buildGenericVideoRequestBody({
      params: { model: 'apimart/seedance', provider: 'apimart', seedanceResolution: '720p', seedanceRatio: '16:9', seedanceDuration: 5, generateAudio: true },
      prompt: 'camera move',
      references: [{ kind: 'image', url: 'https://example.com/ref.png' }],
    })).toMatchObject({
      resolution: '720p',
      aspect_ratio: '16:9',
      duration: 5,
      generate_audio: true,
      image_urls: ['https://example.com/ref.png'],
    });
  });

  it('maps APIMart TTS and Flow Music fields', () => {
    expect(buildAudioSpeechRequestBody({ model: 'tts-1', input: 'hello', voice: 'alloy', format: 'wav', speed: 1 })).toEqual({
      model: 'tts-1', input: 'hello', voice: 'alloy', response_format: 'wav', speed: 1,
    });
    expect(buildAudioMusicRequestBody({ soundPrompt: 'jazz', musicLyrics: 'la', musicTitle: 'demo', musicBpm: 120, musicDuration: 30 })).toEqual({
      model: 'flowmusic', sound_prompt: 'jazz', lyrics: 'la', title: 'demo', bpm: '120', length: 30,
    });
  });

  it('omits undefined fields instead of sending empty provider parameters', () => {
    expect(mapAudioParameters('standard', 'tts', { model: 'tts', input: 'hello', voice: undefined })).toEqual({ model: 'tts', input: 'hello' });
  });
});

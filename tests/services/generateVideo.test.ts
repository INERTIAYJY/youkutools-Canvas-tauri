import { describe, expect, it } from 'vitest';
import { buildGeneralVideoProtocolVariables } from '../../src/services/ai/generateVideo';

describe('general video protocol variables', () => {
  it('maps duration controls and reference media to stable custom-protocol aliases', () => {
    const variables = buildGeneralVideoProtocolVariables(
      'doubao-seedance-2-0-260128',
      {
        model: 'general/seedance-2',
        provider: 'general',
        prompt: 'raw prompt',
        videoResolution: 1280,
        videoFps: 30,
        videoFrames: 129,
        seedanceResolution: '720p',
        seedanceRatio: '16:9',
        seedanceDuration: 6,
        generateAudio: true,
      },
      {
        prompt: 'resolved prompt',
        imageUrls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
        videoUrls: ['https://cdn.example/reference.mp4'],
        audioUrls: ['https://cdn.example/reference.mp3'],
      },
    );

    expect(variables).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      prompt: 'resolved prompt',
      size: '1280x720',
      width: 1280,
      height: 720,
      aspectRatio: '16:9',
      frames: 129,
      frames8n1: 129,
      fps: 30,
      duration: 6,
      resolution: '720p',
      seedanceResolution: '720p',
      generateAudio: true,
      firstImage: 'https://cdn.example/first.png',
      lastImage: 'https://cdn.example/last.png',
      referenceImageUrls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
      referenceVideoUrl: 'https://cdn.example/reference.mp4',
      referenceVideoUrls: ['https://cdn.example/reference.mp4'],
      audioUrl: 'https://cdn.example/reference.mp3',
      referenceAudioUrls: ['https://cdn.example/reference.mp3'],
    });
  });

  it('provides usable defaults and omits a last frame when only one image is present', () => {
    const variables = buildGeneralVideoProtocolVariables(
      'video-model',
      { model: 'general/video', provider: 'general', prompt: 'prompt' },
      {
        prompt: 'prompt',
        imageUrls: ['https://cdn.example/only.png'],
        videoUrls: [],
        audioUrls: [],
      },
    );

    expect(variables).toMatchObject({
      aspectRatio: '16:9',
      duration: 5,
      seedanceResolution: '720p',
      videoFrames: 121,
      videoFps: 24,
      firstImage: 'https://cdn.example/only.png',
      generateAudio: false,
    });
    expect(variables.lastImage).toBeUndefined();
  });
});

/**
 * ai/videoParameterMappings — 视频生成参数到各 Provider 请求字段的声明式映射。
 * 统一的上层参数（model、prompt、resolution、aspectRatio、duration、generateAudio
 * 及参考媒体 imageUrls / videoUrls / audioUrls）按厂商与模型模式换算成各家 API 的真实字段名，
 * 供 buildGenericVideoRequestBody 生成通用视频请求体，避免在调用点散落 if/switch 硬编码。
 */
import type { AIVideoGenParams, MediaReference } from '../../types/aiTypes';

export type VideoParameterKey =
  | 'model'
  | 'prompt'
  | 'resolution'
  | 'aspectRatio'
  | 'duration'
  | 'generateAudio'
  | 'imageUrls'
  | 'videoUrls'
  | 'audioUrls';

export interface VideoParameterMapping {
  providerId: string;
  modelPattern?: RegExp;
  fields: Partial<Record<VideoParameterKey, string>>;
  staticFields?: Record<string, unknown>;
}

const DEFAULT_VIDEO_MAPPING: VideoParameterMapping = {
  providerId: '*',
  fields: { model: 'model', prompt: 'prompt', resolution: 'resolution', aspectRatio: 'aspect_ratio', duration: 'duration', generateAudio: 'generate_audio', imageUrls: 'image_urls', videoUrls: 'video_urls', audioUrls: 'audio_urls' },
};

export const VIDEO_PARAMETER_MAPPINGS: readonly VideoParameterMapping[] = [
  {
    providerId: 'apimart',
    fields: { model: 'model', prompt: 'prompt', resolution: 'resolution', aspectRatio: 'aspect_ratio', duration: 'duration', generateAudio: 'generate_audio', imageUrls: 'image_urls', videoUrls: 'video_urls', audioUrls: 'audio_urls' },
  },
  {
    providerId: 'volcengine',
    fields: { model: 'model', resolution: 'resolution', aspectRatio: 'ratio', duration: 'duration', generateAudio: 'generate_audio' },
  },
  {
    providerId: 'google',
    fields: { model: 'model', prompt: 'prompt', aspectRatio: 'aspectRatio', duration: 'duration', imageUrls: 'image', videoUrls: 'referenceVideos' },
  },
  {
    providerId: 'standard',
    fields: { model: 'model', prompt: 'prompt', resolution: 'resolution', aspectRatio: 'aspect_ratio', duration: 'duration', generateAudio: 'generate_audio', imageUrls: 'image_urls', videoUrls: 'video_urls', audioUrls: 'audio_urls' },
  },
];

export function resolveVideoParameterMapping(providerId: string, modelId = ''): VideoParameterMapping {
  const normalizedProvider = providerId.trim().toLowerCase();
  const match = VIDEO_PARAMETER_MAPPINGS.find((mapping) =>
    mapping.providerId === normalizedProvider && (!mapping.modelPattern || mapping.modelPattern.test(modelId)),
  );
  if (match) return match;
  if (normalizedProvider === 'standard') {
    return VIDEO_PARAMETER_MAPPINGS.find((mapping) => mapping.providerId === 'standard') ?? DEFAULT_VIDEO_MAPPING;
  }
  return DEFAULT_VIDEO_MAPPING;
}

export function mapVideoParameters(
  providerId: string,
  modelId: string,
  values: Partial<Record<VideoParameterKey, unknown>>,
): Record<string, unknown> {
  const mapping = resolveVideoParameterMapping(providerId, modelId);
  const output: Record<string, unknown> = { ...(mapping.staticFields ?? {}) };
  for (const [key, field] of Object.entries(mapping.fields)) {
    const value = values[key as VideoParameterKey];
    if (field && value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) {
      output[field] = value;
    }
  }
  return output;
}

export interface VideoMappingInput {
  params: Pick<AIVideoGenParams, 'model' | 'provider' | 'seedanceResolution' | 'seedanceRatio' | 'seedanceDuration' | 'generateAudio'>;
  prompt: string;
  references?: Pick<MediaReference, 'kind' | 'url'>[];
}

export function buildGenericVideoRequestBody(input: VideoMappingInput): Record<string, unknown> {
  const references = input.references ?? [];
  return mapVideoParameters(input.params.provider, input.params.model, {
    model: input.params.model,
    prompt: input.prompt,
    resolution: input.params.seedanceResolution,
    aspectRatio: input.params.seedanceRatio,
    duration: input.params.seedanceDuration,
    generateAudio: input.params.generateAudio,
    imageUrls: references.filter((item) => item.kind === 'image').map((item) => item.url),
    videoUrls: references.filter((item) => item.kind === 'video').map((item) => item.url),
    audioUrls: references.filter((item) => item.kind === 'audio').map((item) => item.url),
  });
}

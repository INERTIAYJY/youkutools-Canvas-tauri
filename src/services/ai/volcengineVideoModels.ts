/**
 * 声明火山方舟（volcengine）Seedance 视频模型能力表，供 UI 参数选择器按模型约束分辨率 / 时长。
 * 火山方舟走独立的内容生成协议（contents/generations/tasks），与 APIMart 的 videos/generations 不同，
 * 因此能力表只承载 UI 侧的档位约束，不参与请求体映射。
 */
import type { ApimartSeedanceCapability } from './apimartVideoModels';
import {
  getOfficialSeedanceCapability,
  type SeedanceModelVariant,
} from './seedanceModelCapabilities';

function createVolcengineSeedanceCapability(
  variant: SeedanceModelVariant,
  modelId: string,
): ApimartSeedanceCapability {
  const capability = getOfficialSeedanceCapability(variant);
  return {
    modelId,
    resolutions: capability.resolutions ?? [],
    defaultResolution: capability.defaultResolution ?? capability.resolutions?.[0] ?? '720p',
    ratios: capability.ratios ?? [],
    defaultRatio: capability.defaultRatio ?? capability.ratios?.[0] ?? '16:9',
    ratioField: 'aspect_ratio',
    ...(capability.durations?.length ? { durations: capability.durations } : {}),
    minDuration: capability.minDuration ?? 4,
    maxDuration: capability.maxDuration ?? 15,
    ...(capability.defaultDuration === undefined ? {} : { defaultDuration: capability.defaultDuration }),
    ...(capability.automaticDurationValue === undefined
      ? {}
      : { automaticDurationValue: capability.automaticDurationValue }),
    audioField: capability.supportsAudio ? 'generate_audio' : undefined,
    defaultAudio: capability.supportsAudio,
    operations: capability.operations ?? [],
    maxImageReferences: capability.maxImageReferences ?? 0,
    maxVideoReferences: capability.maxVideoReferences,
    maxAudioReferences: capability.maxAudioReferences,
    inputConstraints: capability.inputConstraints,
    inputModeCapabilities: capability.inputModeCapabilities,
    operationCapabilities: capability.operationCapabilities,
  };
}

/**
 * 火山方舟 Seedance 能力表。按官方模型规格限制参数面板可选项，
 * 避免把某个版本不支持的分辨率、比例或时长提交到接口。
 */
const VOLCENGINE_SEEDANCE_CAPABILITIES: Record<string, ApimartSeedanceCapability> = {
  'doubao-seedance-2-0': createVolcengineSeedanceCapability(
    '2.0-standard',
    'doubao-seedance-2-0-260128',
  ),
  'doubao-seedance-2-0-fast': createVolcengineSeedanceCapability(
    '2.0-fast',
    'doubao-seedance-2-0-fast-260128',
  ),
  'doubao-seedance-2-0-mini': createVolcengineSeedanceCapability(
    '2.0-mini',
    'doubao-seedance-2-0-mini-260615',
  ),
  'doubao-seedance-2-5': createVolcengineSeedanceCapability(
    '2.5',
    'doubao-seedance-2-5-260628',
  ),
};

function normalizeVolcengineModelId(model: string): string {
  const stripped = model.startsWith('volcengine/') ? model.slice('volcengine/'.length) : model;
  // 去掉日期版本后缀（如 -260628），使 doubao-seedance-2-5-260628 → doubao-seedance-2-5
  return stripped
    .toLowerCase()
    .replace(/-\d{6,}$/, '');
}

export function getVolcengineSeedanceCapability(
  model?: string,
): ApimartSeedanceCapability | undefined {
  return model ? VOLCENGINE_SEEDANCE_CAPABILITIES[normalizeVolcengineModelId(model)] : undefined;
}

export function isVolcengineSeedanceModel(model?: string): boolean {
  return Boolean(getVolcengineSeedanceCapability(model));
}

export function isVolcengineSeedance25Model(model?: string): boolean {
  return Boolean(model && normalizeVolcengineModelId(model) === 'doubao-seedance-2-5');
}

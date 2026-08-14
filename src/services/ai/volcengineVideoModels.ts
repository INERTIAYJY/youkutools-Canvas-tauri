/**
 * 声明火山方舟（volcengine）Seedance 视频模型能力表，供 UI 参数选择器按模型约束分辨率 / 时长。
 * 火山方舟走独立的内容生成协议（contents/generations/tasks），与 APIMart 的 videos/generations 不同，
 * 因此能力表只承载 UI 侧的档位约束，不参与请求体映射。
 */
import type { ApimartSeedanceCapability } from './apimartVideoModels';

const SD_2_RESOLUTIONS = ['480p', '720p'] as const;
const COMMON_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const;

/**
 * 火山方舟 Seedance 能力表。仅收录需要区别于「默认兜底」的模型：
 * - Seedance 2.5：仅 480p/720p、时长 4~30s（2.0 支持 1080p/4k、4~15s 仍走兜底）
 * 其余未收录模型保持 VideoParamSelector 的通用 Seedance 默认档位。
 */
const VOLCENGINE_SEEDANCE_CAPABILITIES: Record<string, ApimartSeedanceCapability> = {
  'doubao-seedance-2-5': {
    modelId: 'doubao-seedance-2-5-260628',
    resolutions: SD_2_RESOLUTIONS,
    defaultResolution: '720p',
    ratios: COMMON_RATIOS,
    defaultRatio: '16:9',
    ratioField: 'aspect_ratio',
    minDuration: 4,
    maxDuration: 30,
    defaultDuration: 5,
    audioField: 'generate_audio',
    defaultAudio: true,
    operations: ['text-to-video', 'image-to-video', 'video-to-video'],
    maxImageReferences: 30,
    maxVideoReferences: 10,
    maxAudioReferences: 10,
  },
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

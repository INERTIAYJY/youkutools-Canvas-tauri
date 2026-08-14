/**
 * types/visualMemory — 项目视觉记忆类型。
 * 定义与图片内容指纹绑定的项目级视觉描述（ProjectVisualDescription），
 * 以及描述长度上限与提示词版本常量，用于在纯文本模型中替代图片正文。
 */
export const VISUAL_DESCRIPTION_LIMIT = 4_000;
export const VISUAL_DESCRIPTION_PROMPT_VERSION = 'visual-description/v1';

/** 与图片内容指纹绑定的项目级视觉描述；不保存图片正文或本地绝对路径。 */
export interface ProjectVisualDescription {
  id: string;
  projectId: string;
  fingerprint: string;
  description: string;
  modelId: string;
  promptVersion: typeof VISUAL_DESCRIPTION_PROMPT_VERSION;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

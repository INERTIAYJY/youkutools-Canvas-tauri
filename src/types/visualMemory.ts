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

/**
 * 只读领域子智能体的配置模型。
 *
 * 角色是配置数据而不是代码：用户可在设置页自建，也可绑定已上传的 Skill 作为角色说明书。
 * 内置典范不落库，运行时与用户配置合并。
 */

/** 子智能体可读的材料来源，全部只读且由用户在配置里显式勾选。 */
export const SUB_AGENT_MATERIALS = ['mentioned_nodes', 'drama_assets'] as const;
export type SubAgentMaterial = typeof SUB_AGENT_MATERIALS[number];

export const SUB_AGENT_MATERIAL_LABELS: Record<SubAgentMaterial, string> = {
  mentioned_nodes: '用户 @ 引用的节点正文',
  drama_assets: '当前项目的短剧资产',
};

export const SUB_AGENT_LIMITS = {
  /** 单个父任务最多派出的子智能体任务数。 */
  maxTasksPerParent: 6,
  /** 同时并发的子智能体数上限，实际取其与 maxParallelReadTools 的较小值。 */
  maxConcurrency: 3,
  minRounds: 1,
  maxRounds: 6,
  defaultRounds: 3,
  /** 单个子智能体的工具调用上限。 */
  maxToolCalls: 8,
  nameChars: 40,
  descriptionChars: 200,
  instructionsChars: 8000,
  /** 产出回传上限与持久化摘要上限。 */
  resultChars: 6000,
  persistedResultChars: 1000,
} as const;

export interface SubAgentProfile {
  id: string;
  /** 展示名，同时进入模型可见的子智能体索引。 */
  name: string;
  /** 何时该派它，进入索引供模型判断。 */
  description: string;
  /** 角色说明书来自哪个 Skill；与 instructions 二选一，skillId 优先。 */
  skillId?: string;
  /** 用户直接内联的角色提示词。 */
  instructions?: string;
  materials: SubAgentMaterial[];
  maxRounds: number;
  /** 内置典范不可删除、不落库，可复制为自定义副本。 */
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 新建或编辑时的输入，id 与时间戳由 Store 负责。 */
export type SubAgentProfileDraft = Omit<
  SubAgentProfile,
  'id' | 'builtIn' | 'createdAt' | 'updatedAt'
>;

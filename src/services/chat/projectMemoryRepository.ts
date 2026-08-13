import type { ProjectMemory } from '../../types/memory';

/**
 * 项目记忆持久化的完整语义边界。
 * Repository 不负责内容脱敏、排序或上下文选择，这些仍由领域服务处理。
 */
export interface ProjectMemoryRepository {
  save(memory: ProjectMemory): Promise<void>;
  listByProject(projectId: string): Promise<ProjectMemory[]>;
  deleteById(id: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
  reassignProject(fromProjectId: string, toProjectId: string): Promise<void>;
  markConversationSourceUnavailable(conversationId: string): Promise<void>;
}

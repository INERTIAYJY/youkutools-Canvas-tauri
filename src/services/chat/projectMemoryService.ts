/**
 * projectMemoryService — 项目记忆持久化与脱敏（P3-D2）。
 *
 * 记忆只保存简短事实，写入前统一脱敏密钥、凭据和本地绝对路径，
 * 并按长度上限截断，禁止把文件全文、网页全文或临时结果写入长期记忆。
 */
import {
  PROJECT_MEMORY_CONTENT_LIMIT,
  type ProjectMemory,
} from '../../types/memory';
import { indexedDbProjectMemoryRepository } from './indexedDbProjectMemoryRepository';
import type { ProjectMemoryRepository } from './projectMemoryRepository';

/**
 * 脱敏记忆正文：移除密钥、凭据和本地绝对路径，并截断到长度上限。
 * 与 agentRuntime 的持久化摘要脱敏保持一致的模式。
 */
export function sanitizeMemoryContent(value: string): string {
  return value
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, '[已脱敏密钥]')
    .replace(/\b(?:api[_-]?key|authorization|token)\s*[:=]\s*\S+/gi, '[已脱敏凭据]')
    .replace(/[A-Za-z]:\\(?:[^\\\r\n]+\\)*[^\\\r\n]*/g, '[本地路径]')
    .replace(/\/(?:Users|home)\/[^\s"'`]+/g, '[本地路径]')
    .trim()
    .slice(0, PROJECT_MEMORY_CONTENT_LIMIT);
}

export interface ProjectMemoryService {
  saveProjectMemory(memory: ProjectMemory): Promise<void>;
  loadProjectMemories(projectId: string): Promise<ProjectMemory[]>;
  reassignProjectMemories(fromProjectId: string, toProjectId: string): Promise<void>;
  removeProjectMemory(id: string): Promise<void>;
  removeProjectMemories(projectId: string): Promise<void>;
  markConversationMemoriesUnavailable(conversationId: string): Promise<void>;
}

/** 创建可注入 Repository 的领域服务；生产默认继续使用 IndexedDB。 */
export function createProjectMemoryService(
  repository: ProjectMemoryRepository,
): ProjectMemoryService {
  return {
    saveProjectMemory: (memory) => repository.save(memory),
    loadProjectMemories: async (projectId) => {
      const records = await repository.listByProject(projectId);
      return records.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    reassignProjectMemories: (fromProjectId, toProjectId) => (
      repository.reassignProject(fromProjectId, toProjectId)
    ),
    removeProjectMemory: (id) => repository.deleteById(id),
    removeProjectMemories: (projectId) => repository.deleteByProject(projectId),
    markConversationMemoriesUnavailable: (conversationId) => (
      repository.markConversationSourceUnavailable(conversationId)
    ),
  };
}

const defaultProjectMemoryService = createProjectMemoryService(
  indexedDbProjectMemoryRepository,
);

export const saveProjectMemory = defaultProjectMemoryService.saveProjectMemory;
export const loadProjectMemories = defaultProjectMemoryService.loadProjectMemories;
export const reassignProjectMemories = defaultProjectMemoryService.reassignProjectMemories;
export const removeProjectMemory = defaultProjectMemoryService.removeProjectMemory;
export const removeProjectMemories = defaultProjectMemoryService.removeProjectMemories;
export const markConversationMemoriesUnavailable = (
  defaultProjectMemoryService.markConversationMemoriesUnavailable
);

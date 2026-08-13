import {
  deleteProjectMemory,
  deleteProjectMemories,
  getProjectMemories,
  markConversationMemoriesUnavailable,
  putProjectMemory,
} from '../indexedDbService';
import type { ProjectMemoryRepository } from './projectMemoryRepository';

/** 当前默认的离线权威实现。 */
export const indexedDbProjectMemoryRepository: ProjectMemoryRepository = {
  save: (memory) => putProjectMemory(memory),
  listByProject: (projectId) => getProjectMemories(projectId),
  deleteById: (id) => deleteProjectMemory(id),
  deleteByProject: (projectId) => deleteProjectMemories(projectId),
  reassignProject: async (fromProjectId, toProjectId) => {
    const records = await getProjectMemories(fromProjectId);
    await Promise.all(records.map((memory) => putProjectMemory({
      ...memory,
      projectId: toProjectId,
    })));
  },
  markConversationSourceUnavailable: (conversationId) => (
    markConversationMemoriesUnavailable(conversationId)
  ),
};

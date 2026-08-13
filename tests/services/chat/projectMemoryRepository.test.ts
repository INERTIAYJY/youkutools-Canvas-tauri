import { describe, expect, it, vi } from 'vitest';
import {
  createProjectMemoryService,
} from '../../../src/services/chat/projectMemoryService';
import type { ProjectMemoryRepository } from '../../../src/services/chat/projectMemoryRepository';
import type { ProjectMemory } from '../../../src/types/memory';

function memory(id: string, updatedAt: number): ProjectMemory {
  return {
    id,
    projectId: 'project-1',
    kind: 'fact',
    content: `memory ${id}`,
    enabled: true,
    source: { conversationId: 'conversation-1', messageId: 'message-1' },
    createdAt: 1,
    updatedAt,
  };
}

function repository(): ProjectMemoryRepository & Record<string, ReturnType<typeof vi.fn>> {
  return {
    save: vi.fn(async () => undefined),
    listByProject: vi.fn(async () => [memory('older', 10), memory('newer', 20)]),
    deleteById: vi.fn(async () => undefined),
    deleteByProject: vi.fn(async () => undefined),
    reassignProject: vi.fn(async () => undefined),
    markConversationSourceUnavailable: vi.fn(async () => undefined),
  };
}

describe('project memory repository boundary', () => {
  it('delegates all existing persistence operations without changing their arguments', async () => {
    const repo = repository();
    const service = createProjectMemoryService(repo);
    const record = memory('memory-1', 30);

    await service.saveProjectMemory(record);
    await service.removeProjectMemory(record.id);
    await service.removeProjectMemories(record.projectId);
    await service.reassignProjectMemories('project-1', 'series-1');
    await service.markConversationMemoriesUnavailable('conversation-1');

    expect(repo.save).toHaveBeenCalledWith(record);
    expect(repo.deleteById).toHaveBeenCalledWith('memory-1');
    expect(repo.deleteByProject).toHaveBeenCalledWith('project-1');
    expect(repo.reassignProject).toHaveBeenCalledWith('project-1', 'series-1');
    expect(repo.markConversationSourceUnavailable).toHaveBeenCalledWith('conversation-1');
  });

  it('keeps newest-first sorting in the service instead of repository implementations', async () => {
    const repo = repository();
    const service = createProjectMemoryService(repo);

    const result = await service.loadProjectMemories('project-1');

    expect(repo.listByProject).toHaveBeenCalledWith('project-1');
    expect(result.map((item) => item.id)).toEqual(['newer', 'older']);
  });
});

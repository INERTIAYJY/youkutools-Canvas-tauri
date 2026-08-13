import { describe, expect, it } from 'vitest';
import {
  TENCENT_PROJECT_MEMORY_SCHEMA,
  fromTencentAtomicDetail,
  toTencentAtomicUpdateBody,
} from '../../../src/services/chat/tencentAgentMemoryAdapter';
import { PROJECT_MEMORY_CONTENT_LIMIT, type ProjectMemory } from '../../../src/types/memory';

const isolation = {
  teamId: 'team-1',
  agentId: 'agent-ai-canvas',
  userId: 'user-1',
};

function memory(partial: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    id: 'mem-1',
    projectId: 'project-1',
    kind: 'constraint',
    content: '视频时长不得超过十秒',
    enabled: true,
    source: {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      taskId: 'task-1',
    },
    createdAt: 100,
    updatedAt: 200,
    ...partial,
  };
}

describe('TencentDB Agent Memory v3 project memory mapping', () => {
  it('maps project isolation and confirmed memory into an L1 atomic update body', () => {
    const body = toTencentAtomicUpdateBody(memory(), isolation);

    expect(body).toMatchObject({
      team_id: 'team-1',
      agent_id: 'agent-ai-canvas',
      user_id: 'user-1',
      task_id: 'project-1',
      id: 'mem-1',
      content: '视频时长不得超过十秒',
    });
    expect(body).not.toHaveProperty('apiKey');
    expect(JSON.parse(body.background)).toEqual({
      schema: TENCENT_PROJECT_MEMORY_SCHEMA,
      projectId: 'project-1',
      kind: 'constraint',
      enabled: true,
      source: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        taskId: 'task-1',
      },
      createdAt: 100,
      updatedAt: 200,
    });
  });

  it('round-trips all local fields from a valid atomic detail', () => {
    const original = memory({ enabled: false, source: { conversationId: 'c', unavailable: true } });
    const body = toTencentAtomicUpdateBody(original, isolation);
    const restored = fromTencentAtomicDetail({
      id: body.id,
      type: 'atomic',
      content: body.content,
      background: body.background,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:01Z',
    }, 'project-1');

    expect(restored).toEqual(original);
  });

  it('rejects malformed, cross-project, empty and oversized remote records', () => {
    const valid = toTencentAtomicUpdateBody(memory(), isolation);
    const detail = {
      id: valid.id,
      type: 'atomic',
      content: valid.content,
      background: valid.background,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:01Z',
    };

    expect(fromTencentAtomicDetail({ ...detail, background: '{bad json' }, 'project-1')).toBeNull();
    expect(fromTencentAtomicDetail(detail, 'other-project')).toBeNull();
    expect(fromTencentAtomicDetail({ ...detail, content: '' }, 'project-1')).toBeNull();
    expect(fromTencentAtomicDetail({ ...detail, content: null as unknown as string }, 'project-1'))
      .toBeNull();
    expect(fromTencentAtomicDetail({
      ...detail,
      content: 'a'.repeat(PROJECT_MEMORY_CONTENT_LIMIT + 1),
    }, 'project-1')).toBeNull();
  });

  it('refuses to build outbound records that bypass local content limits', () => {
    expect(() => toTencentAtomicUpdateBody(memory({ content: '' }), isolation)).toThrow();
    expect(() => toTencentAtomicUpdateBody(
      memory({ content: 'a'.repeat(PROJECT_MEMORY_CONTENT_LIMIT + 1) }),
      isolation,
    )).toThrow();
    expect(() => toTencentAtomicUpdateBody(memory(), { ...isolation, teamId: '' })).toThrow();
    expect(() => toTencentAtomicUpdateBody(memory({
      source: { conversationId: '' },
    }), isolation)).toThrow();
  });
});

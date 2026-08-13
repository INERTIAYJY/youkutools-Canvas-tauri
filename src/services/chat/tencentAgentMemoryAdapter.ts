/**
 * AI Canvas ProjectMemory 与 TencentDB Agent Memory v3 L1 Atomic 的纯数据映射。
 * 本模块不包含 endpoint、API Key 或网络请求；真实传输必须经过后续受限 Tauri 适配层。
 */
import {
  PROJECT_MEMORY_CONTENT_LIMIT,
  type ProjectMemory,
  type ProjectMemoryKind,
  type ProjectMemorySource,
} from '../../types/memory';

export const TENCENT_PROJECT_MEMORY_SCHEMA = 'ai-canvas.project-memory/v1';

export interface TencentAgentMemoryIsolation {
  teamId: string;
  agentId: string;
  userId: string;
}

/** 对应 Memory Core `POST /v3/atomic/update` 的完整请求体。 */
export interface TencentV3AtomicUpdateBody {
  team_id: string;
  agent_id: string;
  user_id: string;
  task_id: string;
  id: string;
  content: string;
  background: string;
}

/** 对应 v3 `AtomicDetail` 的本阶段所需字段。 */
export interface TencentV3AtomicDetail {
  id: string;
  type: string;
  content: string;
  background?: string;
  created_at: string;
  updated_at: string;
}

interface ProjectMemoryBackgroundV1 {
  schema: typeof TENCENT_PROJECT_MEMORY_SCHEMA;
  projectId: string;
  kind: ProjectMemoryKind;
  enabled: boolean;
  source: ProjectMemorySource;
  createdAt: number;
  updatedAt: number;
}

const MEMORY_KINDS = new Set<ProjectMemoryKind>([
  'preference',
  'fact',
  'constraint',
  'decision',
]);

function requireNonEmpty(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`TencentDB memory mapping requires ${name}`);
  return normalized;
}

function hasValidContent(content: unknown): content is string {
  return typeof content === 'string'
    && content.trim().length > 0
    && content.length <= PROJECT_MEMORY_CONTENT_LIMIT;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseSource(value: unknown): ProjectMemorySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.conversationId !== 'string' || !source.conversationId.trim()) return null;
  if (source.messageId !== undefined && typeof source.messageId !== 'string') return null;
  if (source.taskId !== undefined && typeof source.taskId !== 'string') return null;
  if (source.unavailable !== undefined && typeof source.unavailable !== 'boolean') return null;
  return {
    conversationId: source.conversationId,
    ...(source.messageId !== undefined ? { messageId: source.messageId } : {}),
    ...(source.taskId !== undefined ? { taskId: source.taskId } : {}),
    ...(source.unavailable !== undefined ? { unavailable: source.unavailable } : {}),
  };
}

function parseBackground(value: string | undefined): ProjectMemoryBackgroundV1 | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const source = parseSource(parsed.source);
    if (
      parsed.schema !== TENCENT_PROJECT_MEMORY_SCHEMA
      || typeof parsed.projectId !== 'string'
      || !parsed.projectId.trim()
      || typeof parsed.kind !== 'string'
      || !MEMORY_KINDS.has(parsed.kind as ProjectMemoryKind)
      || typeof parsed.enabled !== 'boolean'
      || !source
      || !isFiniteTimestamp(parsed.createdAt)
      || !isFiniteTimestamp(parsed.updatedAt)
    ) {
      return null;
    }
    return {
      schema: TENCENT_PROJECT_MEMORY_SCHEMA,
      projectId: parsed.projectId,
      kind: parsed.kind as ProjectMemoryKind,
      enabled: parsed.enabled,
      source,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function toTencentAtomicUpdateBody(
  memory: ProjectMemory,
  isolation: TencentAgentMemoryIsolation,
): TencentV3AtomicUpdateBody {
  if (!hasValidContent(memory.content)) {
    throw new Error('TencentDB memory mapping requires a bounded non-empty content');
  }
  const teamId = requireNonEmpty('teamId', isolation.teamId);
  const agentId = requireNonEmpty('agentId', isolation.agentId);
  const userId = requireNonEmpty('userId', isolation.userId);
  const projectId = requireNonEmpty('projectId', memory.projectId);
  const id = requireNonEmpty('memory id', memory.id);
  const source = parseSource(memory.source);
  if (
    !MEMORY_KINDS.has(memory.kind)
    || typeof memory.enabled !== 'boolean'
    || !source
    || !isFiniteTimestamp(memory.createdAt)
    || !isFiniteTimestamp(memory.updatedAt)
  ) {
    throw new Error('TencentDB memory mapping requires valid project memory metadata');
  }
  const background: ProjectMemoryBackgroundV1 = {
    schema: TENCENT_PROJECT_MEMORY_SCHEMA,
    projectId,
    kind: memory.kind,
    enabled: memory.enabled,
    source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
  return {
    team_id: teamId,
    agent_id: agentId,
    user_id: userId,
    task_id: projectId,
    id,
    content: memory.content,
    background: JSON.stringify(background),
  };
}

/** 远端数据只有满足 AI Canvas schema 且属于预期项目时才可恢复。 */
export function fromTencentAtomicDetail(
  detail: TencentV3AtomicDetail,
  expectedProjectId: string,
): ProjectMemory | null {
  const background = parseBackground(detail.background);
  if (
    !background
    || background.projectId !== expectedProjectId
    || typeof detail.id !== 'string'
    || !detail.id.trim()
    || !hasValidContent(detail.content)
  ) {
    return null;
  }
  return {
    id: detail.id,
    projectId: background.projectId,
    kind: background.kind,
    content: detail.content,
    enabled: background.enabled,
    source: background.source,
    createdAt: background.createdAt,
    updatedAt: background.updatedAt,
  };
}

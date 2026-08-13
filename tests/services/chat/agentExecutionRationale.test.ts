import { describe, expect, it } from 'vitest';
import { buildAgentExecutionRationale } from '../../../src/services/chat/agentExecutionRationale';
import type { AgentEvent, AgentTask } from '../../../src/types/agent';

function event(
  sequence: number,
  type: AgentEvent['type'],
  data?: AgentEvent['data'],
): AgentEvent {
  return {
    id: `event-${sequence}`,
    taskId: 'task-1',
    sequence,
    type,
    timestamp: 1000 + sequence,
    data,
  };
}

function task(events: AgentEvent[]): AgentTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    mode: 'collaborative',
    goal: 'audit canvas',
    status: 'paused',
    steps: [{
      id: 'step-1',
      taskId: 'task-1',
      index: 0,
      kind: 'tool',
      title: '读取画布状态',
      status: 'succeeded',
      createdAt: 1,
      updatedAt: 2,
      outputSummary: '画布包含 3 个节点',
      toolCall: {
        callId: 'call-1',
        toolId: 'canvas_get_state',
        inputSummary: '读取节点与连线数量',
        resultSummary: '画布包含 3 个节点',
        retryCount: 1,
      },
    }],
    modelRounds: 1,
    toolCallCount: 1,
    budget: {
      maxModelRounds: 12,
      maxToolCalls: 24,
      maxParallelReadTools: 3,
      maxReadRetries: 3,
    },
    events,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('buildAgentExecutionRationale', () => {
  it('derives a verifiable live trace from model, policy, tool and task events', () => {
    const entries = buildAgentExecutionRationale(task([
      event(0, 'model_round_start'),
      event(1, 'tool_proposed', { toolId: 'canvas_get_state', callId: 'call-1' }),
      event(2, 'policy_decision', {
        toolId: 'canvas_get_state',
        callId: 'call-1',
        effect: 'read',
        decision: 'allow',
      }),
      event(3, 'tool_start', { toolId: 'canvas_get_state', callId: 'call-1' }),
      event(4, 'tool_end', {
        toolId: 'canvas_get_state',
        callId: 'call-1',
        status: 'succeeded',
        durationMs: 1250,
        retryCount: 1,
      }),
      event(5, 'approval_resolved', { approved: false }),
      event(6, 'task_status', { status: 'paused' }),
    ]));

    expect(entries.map((entry) => entry.title)).toEqual([
      '第 1 轮：分析任务',
      '提出工具：读取画布状态',
      '允许执行：读取画布状态',
      '开始执行：读取画布状态',
      '执行完成：读取画布状态',
      '用户未批准操作',
      '任务已暂停',
    ]);
    expect(entries[1].detail).toBe('读取节点与连线数量');
    expect(entries[2].detail).toContain('只读操作');
    expect(entries[4].detail).toContain('画布包含 3 个节点');
    expect(entries[4].meta).toBe('1.3s · 重试 1 次');
  });

  it('uses fixed policy language for confirmation and denial decisions', () => {
    const entries = buildAgentExecutionRationale(task([
      event(0, 'policy_decision', {
        callId: 'call-1',
        effect: 'canvas_write',
        decision: 'require_approval',
      }),
      event(1, 'policy_decision', {
        callId: 'call-1',
        effect: 'canvas_write',
        decision: 'deny',
      }),
    ]));

    expect(entries[0]).toMatchObject({
      title: '等待确认：读取画布状态',
      detail: '画布修改需要根据当前协作模式由用户确认。',
      tone: 'warning',
    });
    expect(entries[1]).toMatchObject({
      title: '已阻止：读取画布状态',
      detail: '本地权限策略拒绝了本次操作。',
      tone: 'error',
    });
  });

  it('keeps only the latest 16 displayable entries', () => {
    const events = Array.from({ length: 20 }, (_, index) => event(index, 'model_round_start'));
    const entries = buildAgentExecutionRationale(task(events));

    expect(entries).toHaveLength(16);
    expect(entries[0].title).toBe('第 5 轮：分析任务');
    expect(entries.at(-1)?.title).toBe('第 20 轮：分析任务');
  });

  it('returns no entries when a legacy task has no journal events', () => {
    expect(buildAgentExecutionRationale(task([]))).toEqual([]);
  });
});

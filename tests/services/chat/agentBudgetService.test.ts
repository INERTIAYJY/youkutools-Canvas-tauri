import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_TASK_BUDGET,
  DEFAULT_AGENT_TASK_METRICS,
  type AgentTask,
  type AgentTaskBudget,
} from '../../../src/types/agent';
import {
  evaluateAgentLifetimeUsage,
  evaluateAgentResumeBudget,
  extendAgentSegmentBudget,
  resolveAgentLifetimeBudget,
  totalAgentTaskTokens,
} from '../../../src/services/chat/agentBudgetService';

function createTask(partial: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    mode: 'autonomous',
    goal: 'build the storyboard',
    status: 'paused',
    steps: [],
    modelRounds: 0,
    toolCallCount: 0,
    resumeCount: 0,
    budget: { ...DEFAULT_AGENT_TASK_BUDGET },
    metrics: { ...DEFAULT_AGENT_TASK_METRICS },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('agent lifetime budget', () => {
  it('falls back to defaults for tasks persisted without lifetime limits', () => {
    const legacyBudget: AgentTaskBudget = {
      maxModelRounds: 12,
      maxToolCalls: 24,
      maxParallelReadTools: 3,
      maxReadRetries: 3,
    };

    expect(resolveAgentLifetimeBudget(legacyBudget)).toEqual({
      maxTotalModelRounds: DEFAULT_AGENT_TASK_BUDGET.maxTotalModelRounds,
      maxTotalToolCalls: DEFAULT_AGENT_TASK_BUDGET.maxTotalToolCalls,
      maxTotalTokens: DEFAULT_AGENT_TASK_BUDGET.maxTotalTokens,
      maxResumes: DEFAULT_AGENT_TASK_BUDGET.maxResumes,
    });
    expect(evaluateAgentLifetimeUsage(createTask({ budget: legacyBudget })).exceeded).toBe(false);
  });

  it('sums input and output tokens across every execution segment', () => {
    const task = createTask({
      metrics: { ...DEFAULT_AGENT_TASK_METRICS, inputTokens: 900, outputTokens: 100 },
    });
    expect(totalAgentTaskTokens(task)).toBe(1000);
  });

  it('stops the task once cumulative rounds, tool calls or tokens hit the lifetime cap', () => {
    expect(evaluateAgentLifetimeUsage(createTask({
      modelRounds: DEFAULT_AGENT_TASK_BUDGET.maxTotalModelRounds,
    }))).toMatchObject({ exceeded: true, errorCode: 'AGENT_LIFETIME_BUDGET_EXHAUSTED' });

    expect(evaluateAgentLifetimeUsage(createTask({
      toolCallCount: DEFAULT_AGENT_TASK_BUDGET.maxTotalToolCalls,
    }))).toMatchObject({ exceeded: true, errorCode: 'AGENT_LIFETIME_BUDGET_EXHAUSTED' });

    expect(evaluateAgentLifetimeUsage(createTask({
      metrics: {
        ...DEFAULT_AGENT_TASK_METRICS,
        inputTokens: DEFAULT_AGENT_TASK_BUDGET.maxTotalTokens,
        outputTokens: 1,
      },
    }))).toMatchObject({ exceeded: true, errorCode: 'AGENT_LIFETIME_BUDGET_EXHAUSTED' });
  });

  it('counts resumes only when validating a new resume, not while a segment runs', () => {
    const task = createTask({ resumeCount: DEFAULT_AGENT_TASK_BUDGET.maxResumes });

    // 运行中的这一段本身就是最后一次继续的产物，逐轮复核不能把它掐断
    expect(evaluateAgentLifetimeUsage(task).exceeded).toBe(false);
    expect(evaluateAgentResumeBudget(task)).toMatchObject({
      exceeded: true,
      errorCode: 'AGENT_LIFETIME_BUDGET_EXHAUSTED',
    });
  });

  it('clamps the widened segment budget to the lifetime cap', () => {
    const task = createTask({
      modelRounds: 58,
      toolCallCount: 118,
      budget: { ...DEFAULT_AGENT_TASK_BUDGET, maxModelRounds: 58, maxToolCalls: 118 },
    });

    expect(extendAgentSegmentBudget(task)).toMatchObject({
      maxModelRounds: DEFAULT_AGENT_TASK_BUDGET.maxTotalModelRounds,
      maxToolCalls: DEFAULT_AGENT_TASK_BUDGET.maxTotalToolCalls,
    });
  });

  it('still widens the segment budget while far below the lifetime cap', () => {
    const task = createTask({
      modelRounds: 12,
      toolCallCount: 24,
      budget: { ...DEFAULT_AGENT_TASK_BUDGET, maxModelRounds: 12, maxToolCalls: 24 },
    });

    expect(extendAgentSegmentBudget(task)).toMatchObject({
      maxModelRounds: 24,
      maxToolCalls: 48,
    });
  });
});

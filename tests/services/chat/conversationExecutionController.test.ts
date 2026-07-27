import { beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  activeTaskId: undefined as string | undefined,
  schedule: vi.fn(() => ({ state: 'running' as const })),
}));

const interjectionMocks = vi.hoisted(() => ({
  enqueue: vi.fn(() => true),
}));

vi.mock('../../../src/services/chat/agentScheduler', () => ({
  getActiveConversationAgentTaskId: () => schedulerMocks.activeTaskId,
  scheduleConversationAgentExecution: schedulerMocks.schedule,
}));

vi.mock('../../../src/services/chat/agentInterjection', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/services/chat/agentInterjection')>(),
  enqueueAgentInterjection: interjectionMocks.enqueue,
}));

vi.mock('../../../src/services/chat/tools', () => ({
  ensureAgentToolsRegistered: vi.fn(),
}));

import {
  resumeAgentTaskExecution,
  submitConversationMessage,
} from '../../../src/services/chat/conversationExecutionController';
import { useAppStore } from '../../../src/store/useAppStore';
import { DEFAULT_AGENT_TASK_BUDGET, type AgentTask } from '../../../src/types/agent';

function arrangeConversation(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    currentProjectId: 'project-1',
    activeConversationId: 'conversation-1',
    conversations: [{
      id: 'conversation-1',
      projectId: 'project-1',
      title: 'Controller test',
      titleSource: 'auto',
      pinned: false,
      archived: false,
      agentMode: 'collaborative',
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
    }],
    messages: [],
    agentTasks: [],
  });
}

beforeEach(() => {
  arrangeConversation();
  schedulerMocks.activeTaskId = undefined;
  schedulerMocks.schedule.mockReset();
  schedulerMocks.schedule.mockReturnValue({ state: 'running' });
  interjectionMocks.enqueue.mockReset();
  interjectionMocks.enqueue.mockReturnValue(true);
});

describe('conversation execution controller', () => {
  it('creates the message pair and schedules one Agent task', () => {
    const result = submitConversationMessage({
      content: '  update the canvas  ',
      conversationId: 'conversation-1',
    });

    expect(result.status).toBe('started');
    const state = useAppStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))).toEqual([
      { role: 'user', content: 'update the canvas' },
      { role: 'assistant', content: '' },
    ]);
    expect(state.agentTasks).toHaveLength(1);
    expect(state.messages[1].agentTaskId).toBe(state.agentTasks[0].id);
    expect(schedulerMocks.schedule).toHaveBeenCalledWith(expect.objectContaining({
      taskId: state.agentTasks[0].id,
      conversationId: 'conversation-1',
    }));
  });

  it('records an interjection without creating another assistant task', () => {
    schedulerMocks.activeTaskId = 'task-active';

    const result = submitConversationMessage({
      content: 'also use the selected nodes',
      conversationId: 'conversation-1',
      dispatchMode: 'interject',
    });

    expect(result).toEqual({ status: 'interjected', taskId: 'task-active' });
    expect(useAppStore.getState().messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'also use the selected nodes',
        agentTaskId: 'task-active',
      }),
    ]);
    expect(schedulerMocks.schedule).not.toHaveBeenCalled();
  });
});

function arrangePausedTask(partial: Partial<AgentTask> = {}): AgentTask {
  const task: AgentTask = {
    id: 'task-paused',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-user',
    mode: 'autonomous',
    goal: 'keep going',
    status: 'paused',
    steps: [],
    modelRounds: 12,
    toolCallCount: 24,
    resumeCount: 0,
    budget: { ...DEFAULT_AGENT_TASK_BUDGET },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
  useAppStore.setState({
    agentTasks: [task],
    messages: [{
      id: 'message-assistant',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      status: 'done',
      agentTaskId: task.id,
    }],
  });
  return task;
}

describe('agent task resume budget', () => {
  it('counts the resume and widens the segment budget within the lifetime cap', () => {
    arrangePausedTask();

    expect(resumeAgentTaskExecution('task-paused')).toEqual({ ok: true });

    const task = useAppStore.getState().agentTasks[0];
    expect(task.resumeCount).toBe(1);
    expect(task.budget).toMatchObject({ maxModelRounds: 24, maxToolCalls: 48 });
    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(1);
  });

  it('refuses to resume and stops widening the budget at the lifetime cap', () => {
    const spent = DEFAULT_AGENT_TASK_BUDGET.maxTotalModelRounds;
    arrangePausedTask({
      modelRounds: spent,
      resumeCount: 4,
      budget: { ...DEFAULT_AGENT_TASK_BUDGET, maxModelRounds: spent },
    });

    expect(resumeAgentTaskExecution('task-paused')).toMatchObject({
      ok: false,
      errorCode: 'AGENT_LIFETIME_BUDGET_EXHAUSTED',
    });

    const task = useAppStore.getState().agentTasks[0];
    expect(task.resumeCount).toBe(4);
    expect(task.budget.maxModelRounds).toBe(spent);
    expect(schedulerMocks.schedule).not.toHaveBeenCalled();
  });
});

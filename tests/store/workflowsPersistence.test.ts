import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../src/store/useAppStore';
import type { WorkflowDefinition } from '../../src/types';

const fileMocks = vi.hoisted(() => ({
  saveWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  loadWorkflows: vi.fn(),
}));

vi.mock('../../src/services/fileService', () => fileMocks);
vi.mock('../../src/services/builtinWorkflows', () => ({
  pendingBuiltInWorkflows: () => [],
  withBuiltInEditableContent: () => null,
}));

import { createWorkflowSlice } from '../../src/store/store.workflows';

const workflow: WorkflowDefinition = {
  id: 'wf-test',
  name: '测试工作流',
  category: 'ai-image',
  fileName: 'test.json',
  fileContent: '{}',
  createdAt: 1,
};

function createSlice(initialWorkflows: WorkflowDefinition[] = []) {
  let state = { workflows: initialWorkflows } as AppState;
  const set = (next: Partial<AppState> | ((current: AppState) => Partial<AppState>)) => {
    const patch = typeof next === 'function' ? next(state) : next;
    state = { ...state, ...patch };
  };
  const slice = createWorkflowSlice(set as never, () => state, {} as never);
  state = { ...state, ...slice, workflows: initialWorkflows };
  return { slice, getState: () => state };
}

beforeEach(() => {
  vi.clearAllMocks();
  fileMocks.saveWorkflow.mockResolvedValue(undefined);
});

describe('工作流持久化顺序', () => {
  it('新增落库失败时不把工作流留在界面状态中', async () => {
    const { slice, getState } = createSlice();
    fileMocks.saveWorkflow.mockRejectedValueOnce(new Error('写入失败'));

    await expect(slice.addWorkflow(workflow)).rejects.toThrow('写入失败');

    expect(getState().workflows).toEqual([]);
  });

  it('更新落库失败时保留原来的工作流状态', async () => {
    const { slice, getState } = createSlice([workflow]);
    fileMocks.saveWorkflow.mockRejectedValueOnce(new Error('写入失败'));

    await expect(slice.updateWorkflow(workflow.id, { name: '未保存的新名称' }))
      .rejects.toThrow('写入失败');

    expect(getState().workflows[0].name).toBe('测试工作流');
  });

  it('落库成功后才更新界面状态', async () => {
    const { slice, getState } = createSlice();
    let resolveSave: (() => void) | undefined;
    fileMocks.saveWorkflow.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));

    const pending = slice.addWorkflow(workflow);
    expect(getState().workflows).toEqual([]);

    resolveSave?.();
    await pending;
    expect(getState().workflows).toEqual([workflow]);
  });
});

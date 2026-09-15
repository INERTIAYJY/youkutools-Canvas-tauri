import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../src/store/useAppStore';
import type { WorkflowDefinition } from '../../src/types';

const fileMocks = vi.hoisted(() => ({
  saveWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  loadWorkflows: vi.fn(),
}));
const builtInMocks = vi.hoisted(() => ({ withBuiltInEditableContent: vi.fn() }));

vi.mock('../../src/services/fileService', () => fileMocks);
vi.mock('../../src/services/builtinWorkflows', () => ({
  pendingBuiltInWorkflows: () => [],
  withBuiltInEditableContent: builtInMocks.withBuiltInEditableContent,
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
  fileMocks.deleteWorkflow.mockResolvedValue(undefined);
  fileMocks.loadWorkflows.mockResolvedValue([]);
  builtInMocks.withBuiltInEditableContent.mockReturnValue(null);
});

describe('工作流持久化顺序', () => {
  it('AutoDL 复用工作流记录，保留执行类型与默认参数并拒绝原始正文', async () => {
    const cloud: WorkflowDefinition = { ...workflow, category: 'ai-video', fileContent: '', adapterType: 'workflow-api',
      workflowApi: { version: 1, adapter: 'autodl-comfyui', workflowId: 'minimax_h3_zm_u24', connectionId: 'autodl-test', defaults: { seed: 0 } } };
    const { slice, getState } = createSlice();
    await slice.addWorkflow(cloud);
    expect(fileMocks.saveWorkflow).toHaveBeenLastCalledWith(expect.objectContaining({ adapterType: 'workflow-api', workflowApi: cloud.workflowApi }));
    fileMocks.loadWorkflows.mockResolvedValue([cloud]); await slice.loadWorkflows();
    expect(getState().workflows[0].workflowApi).toEqual(cloud.workflowApi);
    await expect(slice.updateWorkflow(cloud.id, { adapterType: 'comfyui' })).rejects.toThrow('来源');
    await expect(slice.updateWorkflow(cloud.id, { category: 'ai-image' })).rejects.toThrow('输出类型');
    await expect(slice.updateWorkflow(cloud.id, { fileContent: '{"Authorization":"do-not-save"}' })).rejects.toThrow('不保存');
    expect(JSON.stringify(fileMocks.saveWorkflow.mock.calls)).not.toContain('do-not-save');
  });
  it('云定义在新增、修改与重启加载后完整保留，原始调用示例不落库', async () => {
    const cloud: WorkflowDefinition = { ...workflow, fileContent: '', adapterType: 'runninghub', runninghub: { version: 1, kind: 'app', remoteId: '1904152026220003329', connectionId: 'runninghub', parameters: [{ nodeId: '3', fieldName: 'count', type: 'number', defaultValue: 0, label: '数量', source: 'value' }] } };
    const { slice, getState } = createSlice();
    await slice.addWorkflow(cloud);
    expect(fileMocks.saveWorkflow).toHaveBeenLastCalledWith(expect.objectContaining({ adapterType: 'runninghub', runninghub: cloud.runninghub }));
    await slice.updateWorkflow(cloud.id, { name: '改名' });
    expect(getState().workflows[0].runninghub).toEqual(cloud.runninghub);
    fileMocks.loadWorkflows.mockResolvedValue([{ ...cloud, name: '改名' }]);
    await slice.loadWorkflows();
    expect(getState().workflows[0].runninghub).toEqual(cloud.runninghub);
    await expect(slice.updateWorkflow(cloud.id, { fileContent: '{"apiKey":"do-not-save"}' })).rejects.toThrow('不保存');
    await expect(slice.updateWorkflow(cloud.id, { category: 'ai-text' })).rejects.toThrow('输出类型');
    expect(JSON.stringify(fileMocks.saveWorkflow.mock.calls)).not.toContain('do-not-save');
  });
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
    await vi.waitFor(() => expect(resolveSave).toBeDefined());

    resolveSave?.();
    await pending;
    expect(getState().workflows).toEqual([workflow]);
  });

  it('删除落库失败时保留条目并允许重试', async () => {
    const { slice, getState } = createSlice([workflow]);
    fileMocks.deleteWorkflow.mockRejectedValueOnce(new Error('删除失败'));

    await expect(slice.deleteWorkflow(workflow.id)).rejects.toThrow('删除失败');
    expect(getState().workflows).toEqual([workflow]);

    await slice.deleteWorkflow(workflow.id);
    expect(getState().workflows).toEqual([]);
  });

  it('数据库删除完成前不从界面移除条目', async () => {
    const { slice, getState } = createSlice([workflow]);
    let finishDelete!: () => void;
    fileMocks.deleteWorkflow.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDelete = resolve; }));
    const deleting = slice.deleteWorkflow(workflow.id);
    await vi.waitFor(() => expect(finishDelete).toBeDefined());
    expect(getState().workflows).toEqual([workflow]);

    finishDelete();
    await deleting;
    expect(getState().workflows).toEqual([]);
  });

  it('等待旧编辑写入后再删除，重新加载不会恢复已删除工作流', async () => {
    const disk = new Map([[workflow.id, workflow]]);
    const other = { ...workflow, id: 'other-workflow' };
    disk.set(other.id, other);
    const { slice, getState } = createSlice([...disk.values()]);
    let finishSave!: () => void;
    fileMocks.saveWorkflow.mockImplementationOnce(async (record: WorkflowDefinition) => {
      await new Promise<void>((resolve) => { finishSave = resolve; });
      disk.set(record.id, record);
    });
    fileMocks.deleteWorkflow.mockImplementation(async (id: string) => { disk.delete(id); });
    fileMocks.loadWorkflows.mockImplementation(async () => [...disk.values()]);

    const updating = slice.updateWorkflow(workflow.id, { name: '旧编辑' });
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    const deleting = slice.deleteWorkflow(workflow.id);
    expect(fileMocks.deleteWorkflow).not.toHaveBeenCalled();
    finishSave();
    await Promise.all([updating, deleting]);
    await slice.loadWorkflows();
    expect(getState().workflows).toEqual([other]);

    const restarted = createSlice();
    await restarted.slice.loadWorkflows();
    expect(restarted.getState().workflows).toEqual([other]);
  });

  it('删除后的迟到编辑不能重新创建工作流', async () => {
    const { slice, getState } = createSlice([workflow]);
    const deleting = slice.deleteWorkflow(workflow.id);
    const updating = slice.updateWorkflow(workflow.id, { name: '迟到编辑' });
    await expect(updating).rejects.toThrow('不存在');
    await deleting;
    expect(fileMocks.saveWorkflow).not.toHaveBeenCalled();
    expect(getState().workflows).toEqual([]);
  });

  it('加载时的内置补齐完成后才删除，不留下后台写回', async () => {
    const disk = new Map([[workflow.id, workflow]]);
    const { slice, getState } = createSlice();
    fileMocks.loadWorkflows.mockImplementation(async () => [...disk.values()]);
    builtInMocks.withBuiltInEditableContent.mockReturnValueOnce({ ...workflow, editableContent: '{}' });
    let finishSave!: () => void;
    fileMocks.saveWorkflow.mockImplementationOnce(async (record: WorkflowDefinition) => {
      await new Promise<void>((resolve) => { finishSave = resolve; });
      disk.set(record.id, record);
    });
    fileMocks.deleteWorkflow.mockImplementation(async (id: string) => { disk.delete(id); });

    const loading = slice.loadWorkflows();
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    const deleting = slice.deleteWorkflow(workflow.id);
    expect(fileMocks.deleteWorkflow).not.toHaveBeenCalled();
    finishSave();
    await Promise.all([loading, deleting]);
    await slice.loadWorkflows();
    expect(disk.size).toBe(0);
    expect(getState().workflows).toEqual([]);
  });

  it('重新加载空列表时清除内存中的旧工作流', async () => {
    const { slice, getState } = createSlice([workflow]);
    await slice.loadWorkflows();
    expect(getState().workflows).toEqual([]);
  });

  it('加载失败时保留原列表，不按空列表处理', async () => {
    const { slice, getState } = createSlice([workflow]);
    fileMocks.loadWorkflows.mockRejectedValueOnce(new Error('数据库读取失败'));
    await expect(slice.loadWorkflows()).rejects.toThrow('数据库读取失败');
    expect(getState().workflows).toEqual([workflow]);
    expect(fileMocks.saveWorkflow).not.toHaveBeenCalled();
  });

  it('存储服务不把数据库读取失败伪装成空工作流列表', async () => {
    const db = await import('../../src/services/indexedDbService');
    const storage = await import('../../src/services/storageService');
    const failure = new Error('数据库读取失败');
    vi.spyOn(db, 'getAllWorkflows').mockRejectedValueOnce(failure);
    await expect(storage.loadWorkflows()).rejects.toBe(failure);
  });
});

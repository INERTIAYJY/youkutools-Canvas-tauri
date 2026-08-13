import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkflowAgentTools } from '../../../src/services/chat/tools/workflowTools';
import { registerStyleAgentTools } from '../../../src/services/chat/tools/styleTools';
import { registerSkillAgentTools } from '../../../src/services/chat/tools/skillTools';
import { registerPresetAgentTools } from '../../../src/services/chat/tools/presetTools';
import { registerMemoryAgentTools } from '../../../src/services/chat/tools/memoryTools';
import { clearAgentToolRegistryForTests, getAvailableAgentTools, getAgentTool, type AgentToolContext } from '../../../src/services/chat/toolRegistry';
import { useAppStore } from '../../../src/store/useAppStore';

function context(conversationId = 'mcp-control-project-1'): AgentToolContext {
  return { taskId: 'task-management', projectId: 'project-1', conversationId, mode: 'autonomous', baseRevision: 0, signal: new AbortController().signal };
}

let unregisters: Array<() => void> = [];

beforeEach(() => {
  clearAgentToolRegistryForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'project-1', projects: [{ id: 'project-1', name: '项目', createdAt: 1, updatedAt: 1 }] });
  unregisters = [
    ...registerWorkflowAgentTools(), ...registerStyleAgentTools(), ...registerSkillAgentTools(),
    ...registerPresetAgentTools(), ...registerMemoryAgentTools(),
  ];
});

afterEach(() => {
  unregisters.forEach((unregister) => unregister());
  clearAgentToolRegistryForTests();
});

describe('MCP management tool coverage', () => {
  it('registers complete CRUD effects and keeps dedicated domains MCP-only', () => {
    const expected = {
      workflow_list: 'read', workflow_get: 'read', workflow_create: 'config_write', workflow_update: 'config_write', workflow_delete: 'permanent_delete',
      style_list: 'read', style_get: 'read', style_create: 'config_write', style_update: 'config_write', style_delete: 'permanent_delete',
      skill_list: 'read', skill_get: 'read', skill_create: 'file_write', skill_update: 'file_write', skill_delete: 'permanent_delete',
      preset_delete: 'permanent_delete', memory_list: 'read', memory_get: 'read', memory_update: 'memory_write', memory_delete: 'permanent_delete',
    } as const;
    for (const [id, effect] of Object.entries(expected)) expect(getAgentTool(id)).toMatchObject({ effect });
    expect(getAvailableAgentTools(context('conversation-1')).some((tool) => tool.id === 'workflow_list')).toBe(false);
    expect(getAvailableAgentTools(context()).some((tool) => tool.id === 'workflow_list')).toBe(true);
  });

  it('creates, updates and deletes workflows through Store actions', async () => {
    const addWorkflow = vi.fn(async (workflow) => useAppStore.setState((state) => ({ workflows: [...state.workflows, workflow] })));
    const updateWorkflow = vi.fn(async (id, changes) => useAppStore.setState((state) => ({ workflows: state.workflows.map((item) => item.id === id ? { ...item, ...changes } : item) })));
    const deleteWorkflow = vi.fn(async (id) => useAppStore.setState((state) => ({ workflows: state.workflows.filter((item) => item.id !== id) })));
    useAppStore.setState({ addWorkflow, updateWorkflow, deleteWorkflow });

    const created = await getAgentTool('workflow_create')!.execute(context(), { name: '测试流', category: 'ai-image', fileContent: '{"1":{"class_type":"KSampler"}}' });
    const id = JSON.parse(created.modelContent).workflow.id as string;
    await getAgentTool('workflow_update')!.execute(context(), { workflowId: id, name: '更新流' });
    await getAgentTool('workflow_delete')!.execute(context(), { workflowId: id });

    expect(addWorkflow).toHaveBeenCalledTimes(1);
    expect(updateWorkflow).toHaveBeenCalledWith(id, expect.objectContaining({ name: '更新流' }));
    expect(deleteWorkflow).toHaveBeenCalledWith(id);
  });

  it('manages project memory without leaking source message ids', async () => {
    const memory = useAppStore.getState().createProjectMemory({ projectId: 'project-1', kind: 'fact', content: '主角叫小洛', source: { conversationId: 'private-conversation', messageId: 'private-message' } });
    const list = await getAgentTool('memory_list')!.execute(context(), {});
    const updated = await getAgentTool('memory_update')!.execute(context(), { memoryId: memory.id, enabled: false });
    const deleted = await getAgentTool('memory_delete')!.execute(context(), { memoryId: memory.id });

    expect(list.modelContent).not.toContain('private-message');
    expect(updated.status).toBe('success');
    expect(deleted.status).toBe('success');
  });
});

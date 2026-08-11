/**
 * Workflow slice — ComfyUI workflow CRUD
 */
import type { StateCreator } from 'zustand';
import type { AppState } from './useAppStore';
import type { WorkflowDefinition } from '../types';
import * as fileService from '../services/fileService';
import {
  pendingBuiltInWorkflows,
  withBuiltInEditableContent,
} from '../services/builtinWorkflows';

export interface WorkflowSlice {
  workflows: WorkflowDefinition[];
  workflowPanelOpen: boolean;
  setWorkflowPanelOpen: (open: boolean) => void;
  addWorkflow: (wf: WorkflowDefinition) => void;
  updateWorkflow: (id: string, updates: Partial<Omit<WorkflowDefinition, 'id' | 'createdAt'>>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  loadWorkflows: () => Promise<void>;
}

export const createWorkflowSlice: StateCreator<AppState, [], [], WorkflowSlice> = (set) => ({
  workflows: [],
  workflowPanelOpen: false,

  setWorkflowPanelOpen: (open) => set({ workflowPanelOpen: open }),

  addWorkflow: (wf) => {
    set((state) => ({ workflows: [...state.workflows, wf] }));
    fileService.saveWorkflow({
      id: wf.id,
      name: wf.name,
      category: wf.category,
      fileName: wf.fileName,
      fileContent: wf.fileContent,
      editableContent: wf.editableContent,
      ioNodes: wf.ioNodes,
      defaultNodes: wf.defaultNodes,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
    }).catch((e) => console.warn('[保存工作流] 持久化失败:', e));
  },

  updateWorkflow: async (id, updates) => {
    let updatedWorkflow: WorkflowDefinition | undefined;
    set((state) => ({
      workflows: state.workflows.map((workflow) => {
        if (workflow.id !== id) return workflow;
        updatedWorkflow = { ...workflow, ...updates, id: workflow.id, createdAt: workflow.createdAt };
        return updatedWorkflow;
      }),
    }));
    if (!updatedWorkflow) throw new Error('要更新的工作流不存在');
    await fileService.saveWorkflow(updatedWorkflow);
  },

  deleteWorkflow: async (id) => {
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
    }));
    await fileService.deleteWorkflow(id).catch((e) => console.warn('[删除工作流] 清理失败:', e));
  },

  loadWorkflows: async () => {
    const records = await fileService.loadWorkflows();
    const mapped: WorkflowDefinition[] = records.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category as WorkflowDefinition['category'],
      fileName: r.fileName,
      fileContent: r.fileContent,
      editableContent: r.editableContent,
      ioNodes: r.ioNodes as WorkflowDefinition['ioNodes'],
      defaultNodes: r.defaultNodes as WorkflowDefinition['defaultNodes'],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    // 早先播种的内置工作流缺可编辑图，补上后 ComfyUI 才能正常打开
    const patched = mapped.map((workflow) => {
      const upgraded = withBuiltInEditableContent(workflow);
      if (upgraded) {
        fileService.saveWorkflow(upgraded).catch((e) => console.warn('[内置工作流] 补可编辑图失败:', e));
      }
      return upgraded ?? workflow;
    });
    // 首次启动把内置工作流落盘，之后它们和用户导入的工作流没有区别
    const seeded = pendingBuiltInWorkflows(patched);
    for (const workflow of seeded) {
      fileService.saveWorkflow(workflow).catch((e) => console.warn('[内置工作流] 持久化失败:', e));
    }
    if (patched.length > 0 || seeded.length > 0) set({ workflows: [...seeded, ...patched] });
  },
});

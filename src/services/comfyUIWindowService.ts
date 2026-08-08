import { invoke } from '@tauri-apps/api/core';
import type {
  WorkflowCategory,
  WorkflowDefinition,
  WorkflowIONode,
  WorkflowIONodeType,
} from '../types';
import { generateId, useAppStore } from '../store/useAppStore';

const COMFYUI_SAVE_EVENT = 'comfyui-workflow-save';
const MAX_WORKFLOW_JSON_LENGTH = 16 * 1024 * 1024;

interface ComfyUIWorkflowSavePayload {
  workflowId?: string | null;
  name: string;
  category: WorkflowCategory;
  fileName: string;
  fileContent: string;
  editableContent: string;
}

const IO_TYPE_RULES: { patterns: RegExp[]; type: WorkflowIONodeType }[] = [
  { type: 'image', patterns: [/^LoadImage/i] },
  { type: 'video', patterns: [/^LoadVideo/i, /^VHS_LoadVideo/i, /^VHS_LoadVideoPath/i] },
  { type: 'audio', patterns: [/^LoadAudio/i, /^VHS_LoadAudio/i, /^RecordAudio/i] },
  { type: 'prompt', patterns: [/CLIPTextEncode/i, /TextEncode/i, /StringLiteral/i, /PrimitiveString/i, /^ShowText|pysssss/i] },
];

const WORKFLOW_CATEGORIES = new Set<WorkflowCategory>([
  'ai-text',
  'ai-image',
  'ai-video',
  'ai-audio',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isApiWorkflow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  return Object.values(value).every((node) => (
    isRecord(node)
    && typeof node.class_type === 'string'
    && isRecord(node.inputs)
  ));
}

function isEditableWorkflow(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.nodes);
}

function sanitizeWorkflowFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'comfyui-workflow';
  return `${base.replace(/\.json$/i, '')}.json`;
}

export function extractComfyUIIONodes(jsonStr: string): WorkflowIONode[] {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(jsonStr) as unknown;
    if (!isRecord(value)) return [];
    parsed = value;
  } catch {
    return [];
  }

  const results: WorkflowIONode[] = [];
  for (const [nodeId, raw] of Object.entries(parsed)) {
    if (!isRecord(raw)) continue;
    const classType = String(raw.class_type || '');
    const title = String((isRecord(raw._meta) ? raw._meta.title : undefined) || classType || '');

    for (const rule of IO_TYPE_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(classType))) {
        results.push({ nodeId, title, type: rule.type });
        break;
      }
    }

    const inputs = isRecord(raw.inputs) ? raw.inputs : undefined;
    if (inputs && !results.some((item) => item.nodeId === nodeId)) {
      for (const [key, value] of Object.entries(inputs)) {
        if (/text|prompt|writing/i.test(key) && typeof value === 'string' && value.trim()) {
          results.push({ nodeId, title: title || classType || key, type: 'prompt' });
          break;
        }
      }
    }
  }

  return results;
}

function validateSavePayload(payload: unknown): ComfyUIWorkflowSavePayload {
  if (!isRecord(payload)) throw new Error('ComfyUI 返回的工作流数据无效');
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const fileContent = typeof payload.fileContent === 'string' ? payload.fileContent : '';
  const editableContent = typeof payload.editableContent === 'string' ? payload.editableContent : '';
  const category = payload.category as WorkflowCategory;
  if (!name || name.length > 120) throw new Error('工作流名称无效');
  if (!WORKFLOW_CATEGORIES.has(category)) throw new Error('工作流分类无效');
  if (!fileContent || fileContent.length > MAX_WORKFLOW_JSON_LENGTH) throw new Error('API 工作流内容无效或过大');
  if (!editableContent || editableContent.length > MAX_WORKFLOW_JSON_LENGTH) throw new Error('可编辑工作流内容无效或过大');

  let apiWorkflow: unknown;
  let editableWorkflow: unknown;
  try {
    apiWorkflow = JSON.parse(fileContent) as unknown;
    editableWorkflow = JSON.parse(editableContent) as unknown;
  } catch {
    throw new Error('ComfyUI 返回的工作流 JSON 无法解析');
  }
  if (!isApiWorkflow(apiWorkflow) || !isEditableWorkflow(editableWorkflow)) {
    throw new Error('ComfyUI 返回的工作流格式不受支持');
  }

  return {
    workflowId: typeof payload.workflowId === 'string' && /^wf-[A-Za-z0-9._:-]{1,160}$/.test(payload.workflowId)
      ? payload.workflowId
      : null,
    name,
    category,
    fileName: sanitizeWorkflowFileName(
      typeof payload.fileName === 'string' && payload.fileName.trim() ? payload.fileName : name,
    ),
    fileContent,
    editableContent,
  };
}

export async function openComfyUIWorkflowEditor(
  comfyUrl: string,
  workflow: WorkflowDefinition,
): Promise<void> {
  await invoke<void>('open_comfyui_window', {
    comfyUrl,
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowCategory: workflow.category,
    workflowFileName: workflow.fileName,
    apiJson: workflow.fileContent,
    editableJson: workflow.editableContent ?? null,
  });
}

export async function initComfyUIWindowBridge(): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI__' in window)) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<unknown>(COMFYUI_SAVE_EVENT, async ({ payload }) => {
    const store = useAppStore.getState();
    try {
      const saved = validateSavePayload(payload);
      const existing = saved.workflowId
        ? store.workflows.find((workflow) => workflow.id === saved.workflowId)
        : undefined;
      const now = Date.now();
      if (existing) {
        await store.updateWorkflow(existing.id, {
          name: saved.name,
          category: saved.category,
          fileName: saved.fileName,
          fileContent: saved.fileContent,
          editableContent: saved.editableContent,
          ioNodes: extractComfyUIIONodes(saved.fileContent),
          updatedAt: now,
        });
        store.showToast(`“${saved.name}”已从 ComfyUI 更新`, 'success');
        return;
      }

      const workflow: WorkflowDefinition = {
        id: saved.workflowId || `wf-${generateId()}`,
        name: saved.name,
        category: saved.category,
        fileName: saved.fileName,
        fileContent: saved.fileContent,
        editableContent: saved.editableContent,
        ioNodes: extractComfyUIIONodes(saved.fileContent),
        createdAt: now,
        updatedAt: now,
      };
      store.addWorkflow(workflow);
      store.showToast(`“${saved.name}”已保存到工作流库`, 'success');
    } catch (error) {
      store.showToast(error instanceof Error ? error.message : '保存 ComfyUI 工作流失败', 'error');
    }
  });
}

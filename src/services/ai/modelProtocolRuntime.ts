/** Model-level declarative protocol runtime with resumable async polling. */
import { useAppStore } from '../../store/useAppStore';
import type { GeneralModelCategory, GeneralModelConfig, NodeType } from '../../types';
import type { ProtocolJsonValue } from '../../types/aiTypes';
import {
  cleanupNodePolling,
  registerNodePolling,
  removePendingTask,
  savePendingTask,
} from '../pollManager';
import {
  modelProtocolUsesVariable,
  pollResolvedModelProtocol,
  resolveModelExecutionProfile,
  submitModelProtocol,
  type ModelProtocolVariables,
} from './modelProtocol';
import { REFERENCE_PROTOCOL_VARIABLES } from './modelProtocolVariables';

interface RunConfiguredModelProtocolOptions {
  model: GeneralModelConfig;
  variables: ModelProtocolVariables;
  nodeId?: string;
  category: Exclude<GeneralModelCategory, 'text'>;
  signal?: AbortSignal;
}

const NODE_TYPE_BY_CATEGORY: Record<Exclude<GeneralModelCategory, 'text'>, NodeType> = {
  image: 'ai-image',
  video: 'ai-video',
  audio: 'ai-audio',
};

function readBatchCount(value: ProtocolJsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 1;
}

/**
 * 连线带了参考素材、但该模型的调用协议里一个参考字段都没有时提醒用户。
 * 中转站文档常常只给出纯文生图/文生视频示例，导入后参考图会被静默丢弃，
 * 生成结果看起来「没吃参考图」却查不到原因。
 */
export function findUnusedReferenceVariables(
  protocolSource: string,
  variables: ModelProtocolVariables,
): string[] {
  const provided = REFERENCE_PROTOCOL_VARIABLES.filter((name) => {
    const value = variables[name];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value !== '';
  });
  return modelProtocolUsesVariable(protocolSource, ...provided) ? [] : provided;
}

export async function runConfiguredModelProtocol(
  options: RunConfiguredModelProtocolOptions,
): Promise<string[]> {
  const protocol = resolveModelExecutionProfile(options.model.executionProfile);
  if (!protocol) throw new Error(`模型“${options.model.name}”未配置调用协议`);
  const provider = useAppStore.getState().config.providers[options.model.providerConfigId];
  if (!provider) throw new Error(`模型“${options.model.name}”的连接配置不存在`);
  const baseUrl = provider.baseUrl?.trim() || '';
  if (!baseUrl) throw new Error(`模型“${options.model.name}”未配置接口地址`);
  if (findUnusedReferenceVariables(JSON.stringify(protocol), options.variables).length > 0) {
    useAppStore.getState().showToast(
      `模型“${options.model.name}”的调用协议里没有参考素材字段，连线的参考图/视频/音频不会被发送`,
      'info',
    );
  }

  const nodeSignal = options.nodeId ? registerNodePolling(options.nodeId) : undefined;
  const signal = nodeSignal && options.signal
    ? AbortSignal.any([nodeSignal, options.signal])
    : nodeSignal ?? options.signal;
  try {
    const submitted = await submitModelProtocol({
      apiKey: provider.apiKey || '',
      baseUrl,
      protocol,
      variables: options.variables,
      signal,
    });
    if (submitted.urls) return submitted.urls;
    if (!submitted.poll || !submitted.taskId) throw new Error('异步调用协议未返回轮询配置');

    const projectId = useAppStore.getState().currentProjectId;
    const canPersist = !!options.nodeId && !!projectId;
    if (canPersist) {
      savePendingTask({
        nodeId: options.nodeId!,
        projectId,
        nodeType: NODE_TYPE_BY_CATEGORY[options.category],
        provider: 'general',
        providerConfigId: options.model.providerConfigId,
        taskId: submitted.taskId,
        taskType: 'custom-protocol',
        protocolPoll: submitted.poll,
        batchCount: readBatchCount(options.variables.n),
        submitted: true,
      });
    }

    const result = await pollResolvedModelProtocol(
      submitted.poll,
      provider.apiKey || '',
      signal,
      baseUrl,
    );
    if (!result.urls) throw new Error('媒体模型任务完成但未返回结果 URL');
    return result.urls;
  } finally {
    if (options.nodeId) {
      cleanupNodePolling(options.nodeId);
      removePendingTask(options.nodeId);
    }
  }
}

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
 * 连线带了参考素材、但该模型的调用协议里一个参考字段都没有。
 * 中转站文档常常只给纯文生图 / 文生视频示例，导入后参考素材无处可去。
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

/** 参考素材变量 → 请求体里该写成什么样，给用户一个能直接抄的修法。 */
const REFERENCE_FIELD_HINTS: Array<{ variable: string; kind: string; example: string }> = [
  { variable: 'imageUrls', kind: '参考图', example: '"images": "{{imageUrls}}"' },
  { variable: 'videoUrls', kind: '参考视频', example: '"video_urls": "{{videoUrls}}"' },
  { variable: 'audioUrls', kind: '参考音频', example: '"audio_urls": "{{audioUrls}}"' },
];

/**
 * 参考素材接不住就直接失败，不能放行。
 *
 * 放行的后果不是「参考图被忽略」这么轻：提示词里的 `@` 引用已经被替换成
 * 「图片1」这类占位，请求体里却一张图都没有，上游会回一句
 * `prompt declares reference index 1 but request contains 0 images`，
 * 用户完全看不出是本地协议缺字段。
 */
function assertReferenceMediaDeliverable(
  modelName: string,
  protocolSource: string,
  variables: ModelProtocolVariables,
): void {
  const unused = findUnusedReferenceVariables(protocolSource, variables);
  if (unused.length === 0) return;
  const hints = REFERENCE_FIELD_HINTS.filter((hint) => unused.includes(hint.variable));
  // 只命中派生别名（如 referenceImageUrls）时兜底按参考图给建议
  const effective = hints.length > 0 ? hints : [REFERENCE_FIELD_HINTS[0]];
  throw new Error(
    [
      `模型“${modelName}”的调用协议里没有接收${effective.map((hint) => hint.kind).join(' / ')}的字段，`
        + '连线或提示词里引用的素材发不出去。',
      `请在该模型的「请求体 JSON」里按接口文档补上对应字段（例如 ${effective.map((hint) => hint.example).join('、')}），`
        + '或断开这些参考素材的连线。',
    ].join('\n'),
  );
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
  assertReferenceMediaDeliverable(options.model.name, JSON.stringify(protocol), options.variables);

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

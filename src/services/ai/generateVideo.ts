/**
 * ai/generateVideo — 视频生成入口
 */
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_BASE_URLS } from '../../constants/api';
import { resolveNodeReferences } from '../nodeReferenceService';
import { generateDreaminaVideo } from '../dreaminaService';
import { executeComfyUIVideoGenerate } from '../comfyWorkflowService';
import type { AIVideoGenParams } from '../../types/aiTypes';
import { extractModelName, resolveGeneralModel, resolveGeneralModelConnection } from './helpers';
import { resolvePromptWithImageRefs } from './promptResolver';
import { collectConnectedReferenceMedia, mergeUniqueUrls } from './connectedReferenceMedia';
import { executeGeneralAsyncTask } from './apimartGen';
import { pollTask } from '../pollTask';
import { runConfiguredModelProtocol } from './modelProtocolRuntime';
import { normalizeFrames8n1, type ModelProtocolVariables } from './modelProtocol';
import { mediaProviderRegistry } from './mediaProviderRegistry';
import { mapVideoDimensions } from '../aiDimensions';
import { savePendingTask, updatePendingTask, removePendingTask, registerNodePolling, cleanupNodePolling } from '../pollManager';
import { corsSafeFetch } from './httpTransport';
import { resolveImageUrlArray } from './imageUtils';

interface VideoReferenceInput {
  prompt: string;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
}

async function resolveVideoReferenceInput(
  rawPrompt: string,
  nodeId: string | undefined,
): Promise<VideoReferenceInput> {
  const promptInput = await resolvePromptWithImageRefs(rawPrompt);
  const connected = collectConnectedReferenceMedia(nodeId);
  return {
    prompt: promptInput.prompt,
    imageUrls: mergeUniqueUrls(promptInput.imageUrls, connected.imageUrls),
    videoUrls: connected.videoUrls,
    audioUrls: connected.audioUrls,
  };
}

export function buildGeneralVideoProtocolVariables(
  modelId: string,
  params: AIVideoGenParams,
  referenceInput: VideoReferenceInput,
): ModelProtocolVariables {
  const frames = params.videoFrames ?? 121;
  const videoResolution = params.videoResolution ?? 1152;
  const aspectRatio = params.seedanceRatio ?? '16:9';
  const { width, height } = mapVideoDimensions(videoResolution, aspectRatio);
  const fps = params.videoFps ?? 24;
  const duration = params.seedanceDuration ?? 5;
  const seedanceResolution = params.seedanceResolution ?? '720p';
  const firstImage = referenceInput.imageUrls[0];
  const lastImage = referenceInput.imageUrls.length > 1
    ? referenceInput.imageUrls[referenceInput.imageUrls.length - 1]
    : undefined;

  return {
    model: modelId,
    prompt: referenceInput.prompt,
    size: `${width}x${height}`,
    aspectRatio,
    width,
    height,
    frames,
    frames8n1: normalizeFrames8n1(frames),
    fps,
    duration,
    resolution: seedanceResolution,
    videoResolution,
    videoFrames: frames,
    videoFps: fps,
    seedanceResolution,
    seedanceRatio: aspectRatio,
    seedanceDuration: duration,
    generateAudio: params.generateAudio ?? false,
    imageUrls: referenceInput.imageUrls,
    firstImage,
    lastImage,
    referenceImageUrls: referenceInput.imageUrls,
    videoUrls: referenceInput.videoUrls,
    referenceVideoUrl: referenceInput.videoUrls[0],
    referenceVideoUrls: referenceInput.videoUrls,
    audioUrls: referenceInput.audioUrls,
    audioUrl: referenceInput.audioUrls[0],
    referenceAudioUrls: referenceInput.audioUrls,
    n: 1,
    batchCount: 1,
  };
}

export async function generateVideo(
  params: AIVideoGenParams,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  const { prompt: rawPrompt, model, provider } = params;

  // 解析 @{nodeId:label} 引用为对应节点的实际输出内容
  const prompt = resolveNodeReferences(rawPrompt);

  // ComfyUI 工作流执行路径
  if (params.workflowId) {
    return executeComfyUIVideoGenerate({ ...params, prompt }, signal);
  }

  const registeredAdapter = mediaProviderRegistry.getVideoAdapter(provider);
  if (registeredAdapter) {
    return registeredAdapter.generateVideo({
      params,
      prompt,
      resolveReferenceInput: async () => {
        return resolveVideoReferenceInput(rawPrompt, params.nodeId);
      },
      signal,
    });
  }

  // 即梦视频：无参考图 → text2video；有参考图 → image2video
  if (provider === 'dreamina') {
    const referenceInput = await resolveVideoReferenceInput(rawPrompt, params.nodeId);
    const dreaminaPrompt = referenceInput.prompt;
    if (!dreaminaPrompt.trim()) throw new Error('提示词不能为空');
    return generateDreaminaVideo({
      prompt: dreaminaPrompt,
      model,
      imageUrls: referenceInput.imageUrls,
      nodeId: params.nodeId,
      ratio: params.seedanceRatio,
      duration: params.seedanceDuration,
      resolution: params.seedanceResolution,
    }, signal);
  }

  // ── 火山方舟 Seedance 视频生成 ──
  if (provider === 'volcengine') {
    const config = useAppStore.getState().config;
    const providerConfig = config.providers.volcengine;
    const apiKey = providerConfig?.apiKey || '';
    if (!apiKey) {
      throw new Error('未配置 火山方舟 的 API Key\n请在「设置 → API Key」中配置');
    }
    const baseUrl = (providerConfig?.baseUrl || DEFAULT_BASE_URLS.volcengine || '').replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error('未配置 火山方舟 的服务地址\n请在「设置 → API Key」中添加');
    }
    const modelName = extractModelName(model, provider);
    const referenceInput = await resolveVideoReferenceInput(rawPrompt, params.nodeId);
    const resolvedPrompt = referenceInput.prompt;
    const mergedImageUrls = referenceInput.imageUrls;
    if (!resolvedPrompt.trim() && mergedImageUrls.length === 0) {
      throw new Error('提示词不能为空');
    }
    const remoteImageUrls = await resolveImageUrlArray(mergedImageUrls, 'volcengine');
    return generateVolcengineVideo(
      apiKey,
      baseUrl,
      modelName,
      resolvedPrompt,
      remoteImageUrls,
      params,
      signal,
    );
  }

  // ── 通用模型视频生成 ──
  if (provider === 'general') {
    const gm = resolveGeneralModel(model);
    if (!gm) throw new Error('未找到该通用模型配置\n请在「设置 → API Key」中检查');
    const connection = resolveGeneralModelConnection(model);
    if (!connection) throw new Error(`通用模型 "${gm.name}" 的连接配置不存在`);
    if (!connection.baseUrl) throw new Error(`通用模型 "${gm.name}" 未配置接口地址`);
    if (gm.executionProfile) {
      const referenceInput = await resolveVideoReferenceInput(rawPrompt, params.nodeId);
      const remoteImageUrls = await resolveImageUrlArray(
        referenceInput.imageUrls,
        connection.providerConfigId,
      );
      const urls = await runConfiguredModelProtocol({
        model: gm,
        category: 'video',
        nodeId: params.nodeId,
        signal,
        variables: buildGeneralVideoProtocolVariables(gm.modelId, params, {
          ...referenceInput,
          imageUrls: remoteImageUrls,
        }),
      });
      const url = urls[0];
      if (!url) throw new Error('视频生成完成但未返回结果');
      return { url };
    }
    return executeGeneralAsyncTask(
      connection.apiKey,
      connection.baseUrl,
      gm.modelId,
      prompt,
      'videos',
      connection.providerConfigId,
      params.nodeId,
      signal,
    );
  }

  // 无 workflowId 时暂不支持直接调用 API，提示配置
  throw new Error('视频生成需要选择 ComfyUI 工作流\n请在模型选择器中导入并选择工作流');
}

/** 火山方舟 Seedance 视频生成 — 异步提交 + 轮询 */
async function generateVolcengineVideo(
  apiKey: string,
  baseUrl: string,
  modelName: string,
  prompt: string,
  imageUrls: string[],
  params: AIVideoGenParams,
  externalSignal?: AbortSignal,
): Promise<{ url: string }> {
  const nodeId = params.nodeId;
  const nodeSignal = nodeId ? registerNodePolling(nodeId) : undefined;
  const signal = nodeSignal && externalSignal
    ? AbortSignal.any([nodeSignal, externalSignal])
    : nodeSignal ?? externalSignal;

  try {
    // 预存待续任务
    if (nodeId) {
      const projectId = useAppStore.getState().currentProjectId;
      if (projectId) {
        savePendingTask({
          nodeId,
          projectId,
          nodeType: 'ai-video',
          provider: 'volcengine',
          providerConfigId: 'volcengine',
          taskId: '',
          taskType: 'volcengine',
          submitted: false,
        });
      }
    }

    // 构建 content 数组
    const content: Array<Record<string, unknown>> = [];
    if (prompt.trim()) {
      content.push({ type: 'text', text: prompt.trim() });
    }
    for (const url of imageUrls) {
      content.push({
        type: 'image_url',
        image_url: { url },
      });
    }

    // 构建请求体 — 直接使用 Seedance 原生参数
    const ratio = params.seedanceRatio || '16:9';
    const duration = params.seedanceDuration ?? 5;
    const resolution = params.seedanceResolution || '720p';
    const requestBody: Record<string, unknown> = {
      model: modelName,
      content,
      ratio,
      duration,
      resolution,
      watermark: true,
    };
    if (params.generateAudio) {
      requestBody.generate_audio = true;
    }

    // 提交任务
    const apiUrl = `${baseUrl}/contents/generations/tasks`;
    const submitResp = await corsSafeFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!submitResp.ok) {
      const errBody = await submitResp.text().catch(() => '');
      let errorMsg = `提交失败 (${submitResp.status})`;
      try {
        const err = JSON.parse(errBody);
        errorMsg = err.error?.message || errorMsg;
      } catch {
        if (errBody) errorMsg += `: ${errBody.slice(0, 200)}`;
      }
      throw new Error(errorMsg);
    }

    const submitResult = await submitResp.json() as { id?: string };
    const taskId = submitResult.id;
    if (!taskId) {
      throw new Error('火山方舟视频生成提交失败: 未返回任务 ID');
    }

    // 回填 taskId
    if (nodeId) {
      updatePendingTask(nodeId, { taskId, submitted: true });
    }

    // 轮询
    return await pollTask<Record<string, unknown>, { url: string }>({
      fetchState: async () => {
        const pollResp = await corsSafeFetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        });
        if (!pollResp.ok) throw new Error(`HTTP ${pollResp.status}`);
        return (await pollResp.json()) as Record<string, unknown>;
      },
      isComplete: (raw) => {
        const status = raw.status as string;
        if (status === 'succeeded') {
          const c = raw.content as Record<string, unknown> | undefined;
          const videoUrl = c?.video_url as string | undefined;
          if (videoUrl) return { url: videoUrl };
          throw new Error('任务完成但未返回视频地址');
        }
        return null;
      },
      isFailed: (raw) => {
        const status = raw.status as string;
        if (status === 'failed' || status === 'cancelled') {
          const err = raw.error as { message?: string } | undefined;
          return `任务失败: ${err?.message || status}`;
        }
        return null;
      },
      interval: 3000,
      signal,
    });

  } finally {
    if (nodeId) {
      cleanupNodePolling(nodeId);
      removePendingTask(nodeId);
    }
  }
}

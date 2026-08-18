/**
 * seedlingTools — 森之灵（Seedling）Agent 工具
 *
 * 通过 Seedling CLI 提交/查询视频生成任务，全部走现有 Tool Registry 与 Policy Engine：
 *   - seedling_list_models（read）：列出可用模型
 *   - seedling_create_video（media_generation）：提交视频生成任务并等待结果
 *   - seedling_query_task（read）：查询任务状态
 *
 * 安全边界：
 *   - 认证检查放在 authorize：API Token（config.providers.seedling.apiKey）或 CLI 登录态任一可用；
 *   - 参考素材只接受 http(s) URL，不接受本地路径（避免模型诱导读取本地文件）；
 *   - 返回的 modelContent 不含 API Token 与敏感路径，仅含任务状态与结果摘要。
 */
import { useAppStore } from '../../../store/useAppStore';
import type { AgentToolDisplaySnapshot } from '../../../types/agent';
import { registerAgentTool } from '../toolRegistry';
import {
  createSeedlingVideoTask,
  fetchSeedlingModels,
  fetchSeedlingTask,
  waitSeedlingTask,
} from '../../seedlingService';

const SEEDLING_RESOLUTIONS = ['480p', '720p', '1080p'];
const SEEDLING_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

function seedlingAuthorized(): boolean {
  const config = useAppStore.getState().config;
  return Boolean(config.providers?.seedling?.apiKey) || Boolean(config.seedlingAuth?.loggedIn);
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

interface SeedlingCreateVideoInput {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
  audio?: boolean;
  resources?: string[];
}

function buildCreateVideoDisplay(input: SeedlingCreateVideoInput): AgentToolDisplaySnapshot {
  const fields: NonNullable<AgentToolDisplaySnapshot['fields']> = [
    { label: '提示词', value: input.prompt.trim().slice(0, 500) },
    { label: '模型', value: input.model || '默认模型' },
  ];
  if (input.duration != null) fields.push({ label: '时长', value: `${input.duration} 秒` });
  if (input.resolution) fields.push({ label: '分辨率', value: input.resolution });
  if (input.ratio) fields.push({ label: '画面比例', value: input.ratio });
  if (input.audio) fields.push({ label: '配乐', value: '开启' });
  if (input.resources?.length) {
    fields.push({ label: '参考素材', value: `${input.resources.length} 个` });
  }
  return { fields };
}

export function registerSeedlingAgentTools(): Array<() => void> {
  return [
    registerAgentTool({
      id: 'seedling_list_models',
      title: '查看森之灵可用模型',
      description: [
        '列出 Seedling（森之灵）当前可用的视频生成模型及其能力（分辨率、画面比例、配乐支持）。',
        '生成视频前可先调用本工具选择合适模型。',
      ].join(''),
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      effect: 'read',
      authorize: () => {
        if (!seedlingAuthorized()) {
          return { allowed: false, reason: '请先在「设置 → 森之灵」中填写 API Token 或完成 CLI 登录' };
        }
        return { allowed: true };
      },
      execute: async () => {
        try {
          const payload = await fetchSeedlingModels();
          const lines = (payload.models ?? []).map((model) => {
            const resolutions = model.supportedResolutions?.length
              ? model.supportedResolutions.join('/')
              : '默认分辨率';
            const audio = model.supportsAudio ? '，支持配乐' : '';
            const description = model.description ? ` — ${model.description}` : '';
            return `- ${model.name}（${model.id}）：${resolutions}${audio}${description}`;
          });
          const modelContent = lines.length > 0
            ? `森之灵可用视频模型：\n${lines.join('\n')}`
            : '森之灵暂无可用模型';
          return { status: 'success', summary: '森之灵可用模型', modelContent };
        } catch (error) {
          const message = summarizeError(error);
          return {
            status: 'error',
            summary: '查询森之灵模型失败',
            modelContent: message,
            retryable: true,
          };
        }
      },
    }),

    registerAgentTool<SeedlingCreateVideoInput>({
      id: 'seedling_create_video',
      title: '森之灵生成视频',
      description: [
        '通过 Seedling（森之灵）CLI 生成视频并等待任务完成，返回结果视频地址。',
        'model 使用 seedling_list_models 返回的模型 ID（如 quality、fast、kling）；省略时使用默认模型。',
        'duration 为 4~15 秒；resolution 支持 480p/720p/1080p；ratio 支持 16:9、9:16、1:1、4:3、3:4、21:9。',
        'audio 为 true 时开启 AI 配乐。resources 为参考素材的 http(s) URL 列表（首尾帧按数组顺序）。',
        '属于付费媒体生成，Policy 将按当前模式决定是否需要确认。',
      ].join(''),
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 4000, description: '视频生成提示词' },
          model: { type: 'string', minLength: 1, maxLength: 100, description: '模型 ID' },
          duration: { type: 'integer', minimum: 4, maximum: 15, description: '视频时长（秒）' },
          resolution: { type: 'string', enum: SEEDLING_RESOLUTIONS, description: '分辨率档位' },
          ratio: { type: 'string', enum: SEEDLING_RATIOS, description: '画面比例' },
          audio: { type: 'boolean', description: '是否开启 AI 配乐' },
          resources: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 2000 },
            maxItems: 10,
            description: '参考素材 http(s) URL 列表',
          },
        },
      },
      effect: 'media_generation',
      buildInputDisplay: (input) => buildCreateVideoDisplay(input),
      authorize: () => {
        if (!seedlingAuthorized()) {
          return { allowed: false, reason: '请先在「设置 → 森之灵」中填写 API Token 或完成 CLI 登录' };
        }
        return { allowed: true };
      },
      execute: async (context, input) => {
        const prompt = input.prompt.trim();
        if (!prompt) {
          return { status: 'error', summary: '提示词为空', modelContent: '提示词不能为空' };
        }
        if (input.resources?.some((url) => !/^https?:\/\//i.test(url.trim()))) {
          return {
            status: 'error',
            summary: '参考素材必须是 http(s) URL',
            modelContent: '参考素材只接受 http(s) URL，不接受本地路径',
          };
        }
        try {
          const { taskId } = await createSeedlingVideoTask({
            prompt,
            model: input.model,
            duration: input.duration,
            resolution: input.resolution,
            ratio: input.ratio,
            audio: input.audio,
            resources: input.resources?.map((url) => url.trim()).filter(Boolean),
          });
          const task = await waitSeedlingTask(taskId, context.signal);
          if (!task.videoUrl) {
            return {
              status: 'error',
              summary: '森之灵未返回视频结果',
              modelContent: task.errorMessage || '任务完成但未返回视频地址',
            };
          }
          return {
            status: 'success',
            summary: `森之灵视频任务 ${taskId} 已完成`,
            modelContent: `森之灵视频生成完成（任务 ${taskId}）：${task.videoUrl}`,
          };
        } catch (error) {
          const message = summarizeError(error);
          const isAbort = error instanceof DOMException && error.name === 'AbortError';
          return {
            status: isAbort ? 'error' : 'error',
            summary: isAbort ? '任务已取消' : '森之灵视频生成失败',
            modelContent: isAbort ? '视频生成任务已取消' : message,
            retryable: !isAbort,
          };
        }
      },
    }),

    registerAgentTool({
      id: 'seedling_query_task',
      title: '查询森之灵任务',
      description: '查询 Seedling（森之灵）视频生成任务的状态与结果。taskId 来自 seedling_create_video 的返回。',
      inputSchema: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: { type: 'integer', minimum: 1, description: '森之灵任务 ID' },
        },
      },
      effect: 'read',
      authorize: () => {
        if (!seedlingAuthorized()) {
          return { allowed: false, reason: '请先在「设置 → 森之灵」中填写 API Token 或完成 CLI 登录' };
        }
        return { allowed: true };
      },
      execute: async (_context, input: { taskId: number }) => {
        try {
          const task = await fetchSeedlingTask(Number(input.taskId));
          const params = task.params ?? {};
          const parts = [
            `任务 ${task.taskId} 状态：${task.status}`,
            params.model ? `模型：${params.model}` : '',
            task.fullPrompt ? `提示词：${task.fullPrompt.slice(0, 300)}` : '',
            task.videoUrl ? `视频地址：${task.videoUrl}` : '',
            task.errorMessage ? `错误：${task.errorMessage}` : '',
          ].filter(Boolean).join('\n');
          return { status: 'success', summary: `森之灵任务 ${task.taskId}`, modelContent: parts };
        } catch (error) {
          return {
            status: 'error',
            summary: '查询森之灵任务失败',
            modelContent: summarizeError(error),
            retryable: true,
          };
        }
      },
    }),
  ];
}

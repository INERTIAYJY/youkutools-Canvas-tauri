/**
 * seedlingService — 森之灵（Seedling）CLI 前端封装
 *
 * 通过 Rust 受控命令驱动 seedling 二进制：
 *   - 认证：仅使用 CLI 浏览器授权登录态；
 *   - 视频生成：task create → task get 轮询 → videoUrl / task download
 *   - 素材上传：resource upload（本地文件 → 在线 URL）
 *
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { logAiRequest } from './ai/httpTransport';
import { pollTask } from './pollTask';

// ── 领域类型 ──

export interface SeedlingAuthStatus {
  loggedIn: boolean;
  username: string;
  endpoint: string;
  tokenPreview: string;
  tokenSource: string;
  message: string;
}

export interface SeedlingCliStatus {
  found: boolean;
  source: string;
  version?: string;
  auth?: SeedlingAuthStatus;
  error?: string;
}

export interface SeedlingAuthLoginRuntime {
  active: boolean;
  phase: string;
  message: string;
  error: string;
  verificationUrl: string;
  userCode: string;
  username: string;
}

export interface SeedlingModelInfo {
  id: string;
  name: string;
  description?: string;
  supportedResolutions?: string[];
  supportedRatios?: string[];
  supportsAudio?: boolean;
  supportsReferenceGeneration?: boolean | string[];
  supportsHeadToEnd?: boolean;
  /** 模型支持的最长时长（秒）；缺省按 CLI 的 4~15 秒合同处理。 */
  maxDuration?: number;
  /** 参考素材上限（`models list` 的 maxReferenceCounts）。 */
  maxReferenceCounts?: {
    image?: number;
    video?: number;
    audio?: number;
  };
}

export interface SeedlingModelStatus {
  id: string;
  busyStatus: string;
}

export interface SeedlingTaskParams {
  model?: string;
  ratio?: string;
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
}

export interface SeedlingTaskDetail {
  taskId: number;
  status: string;
  fullPrompt?: string;
  params?: SeedlingTaskParams;
  videoUrl?: string | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SeedlingCreateTaskInput {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
  audio?: boolean;
  resources?: string[];
}

/**
 * 该模型的配乐能力（目录 `models list` → `supportsAudio`）。
 *
 * 森之灵 CLI 的 `task create` 只在显式传入 `--audio` 时才生成 AI 配乐（`--audio` 默认 false），
 * 所以「调用方没有显式选择」不能直接落到 false，否则画布与对话生成的视频一定无声。
 * 目录未拉取或模型不在目录时返回 false，保持 CLI 自身的默认行为。
 */
export function resolveSeedlingAudioDefault(modelId: string | undefined): boolean {
  const id = modelId?.trim().replace(/^seedling\//, '');
  if (!id) return false;
  const selectedModels = useAppStore.getState().config.providers?.seedling?.selectedModels;
  return selectedModels?.find((model) => model.id === id)?.videoCapability?.supportsAudio === true;
}

async function invokeTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    // 不记录 Seedling 的认证令牌或本机素材路径。
    logAiRequest(`tauri://${cmd}`, {
      method: 'INVOKE',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    }, 'Seedling');
    const invokePromise = invoke<T>(cmd, args);
    if (!signal) return await invokePromise;
    return await new Promise<T>((resolve, reject) => {
      const handleAbort = () => {
        signal.removeEventListener('abort', handleAbort);
        reject(new DOMException('请求已取消', 'AbortError'));
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      invokePromise.then(
        (result) => {
          signal.removeEventListener('abort', handleAbort);
          resolve(result);
        },
        (error) => {
          signal.removeEventListener('abort', handleAbort);
          reject(error);
        },
      );
    });
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(typeof e === 'string' ? e : JSON.stringify(e), { cause: e });
  }
}

// ── CLI / 认证 ──

/** 查询仅由 Seedling CLI 配置文件提供的登录态。 */
export async function fetchSeedlingCliStatus(): Promise<SeedlingCliStatus> {
  return invokeTauri<SeedlingCliStatus>('seedling_cli_status', {});
}

/**
 * 显式安装 / 更新应用内置 CLI（强制从官方 CDN 下载最新版到应用缓存目录）。
 * 返回安装后的 CLI 状态（含版本与认证信息）。
 */
export async function installSeedlingCli(): Promise<SeedlingCliStatus> {
  return invokeTauri<SeedlingCliStatus>('seedling_install_cli', {});
}

export async function startSeedlingAuthLogin(): Promise<SeedlingAuthLoginRuntime> {
  return invokeTauri<SeedlingAuthLoginRuntime>('seedling_auth_login_start', {});
}

export async function getSeedlingAuthLoginRuntime(): Promise<SeedlingAuthLoginRuntime> {
  return invokeTauri<SeedlingAuthLoginRuntime>('seedling_auth_login_runtime', {});
}

export async function cancelSeedlingAuthLogin(): Promise<SeedlingAuthLoginRuntime> {
  return invokeTauri<SeedlingAuthLoginRuntime>('seedling_auth_login_cancel', {});
}

export async function logoutSeedling(): Promise<SeedlingAuthLoginRuntime> {
  return invokeTauri<SeedlingAuthLoginRuntime>('seedling_auth_logout', {});
}

// ── 模型 ──

export async function fetchSeedlingModels(): Promise<{
  models: SeedlingModelInfo[];
  statuses: SeedlingModelStatus[];
}> {
  return invokeTauri<{ models: SeedlingModelInfo[]; statuses: SeedlingModelStatus[] }>(
    'seedling_models',
    {},
  );
}

// ── 任务 ──

export async function createSeedlingVideoTask(
  input: SeedlingCreateTaskInput,
): Promise<{ taskId: number }> {
  return invokeTauri<{ taskId: number }>('seedling_task_create', {
    params: input,
  });
}

export async function fetchSeedlingTask(taskId: number): Promise<SeedlingTaskDetail> {
  return invokeTauri<SeedlingTaskDetail>('seedling_task_get', { taskId });
}

export async function listSeedlingTasks(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: SeedlingTaskDetail[]; total: number }> {
  return invokeTauri<{ tasks: SeedlingTaskDetail[]; total: number }>('seedling_task_list', {
    params: {
      status: options?.status ?? '',
      limit: options?.limit,
      offset: options?.offset,
    },
  });
}

export async function cancelSeedlingTask(taskId: number): Promise<unknown> {
  return invokeTauri('seedling_task_cancel', { taskId });
}

/**
 * 下载任务视频到本地（output 需为项目授权目录内的绝对路径，Rust 侧再做路径校验）。
 * 返回 CLI 文本输出（一般含保存路径）。
 */
export async function downloadSeedlingTask(taskId: number, output: string): Promise<string> {
  return invokeTauri<string>('seedling_task_download', {
    taskId,
    output,
  });
}

/** 上传本地素材文件，返回在线 URL（供 task create 的 resources 使用）。 */
export async function uploadSeedlingResource(filePath: string): Promise<{ url: string }> {
  return invokeTauri<{ url: string }>('seedling_resource_upload', {
    filePath,
  });
}

// ── 任务轮询 ──

export const SEEDLING_POLL_INTERVAL_MS = 3000;
export const SEEDLING_MAX_POLL_MS = 60 * 60 * 1000; // 1 小时上限（视频生成可能较久）

export const SEEDLING_TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'cancelled'] as const;

/** 轮询任务直至终态，返回最终任务详情。 */
export async function waitSeedlingTask(
  taskId: number,
  signal?: AbortSignal,
): Promise<SeedlingTaskDetail> {
  return pollTask<SeedlingTaskDetail, SeedlingTaskDetail>({
    fetchState: () => fetchSeedlingTask(taskId),
    isComplete: (task) => task.status === 'succeeded' ? task : null,
    isFailed: (task) =>
      ['failed', 'expired', 'cancelled'].includes(task.status)
        ? (() => {
          const reason = task.errorMessage || task.errorCode || `Seedling 任务${task.status}`;
          // 提交失败是服务端瞬时拒单（无上游任务 ID），可直接重试；其余终态保留原文。
          const retryHint = task.errorCode === 'SubmitFailed'
            ? '；这是森之灵服务端瞬时拒单，请在该节点重新点生成重试' : '';
          return `森之灵任务 #${task.taskId} ${reason}${retryHint}`;
        })()
        : null,
    interval: SEEDLING_POLL_INTERVAL_MS,
    maxDuration: SEEDLING_MAX_POLL_MS,
    timeoutMsg: 'Seedling 生成超时，任务仍在后台运行，可稍后在任务中心查看',
    onFetchError: 'continue',
    signal,
  });
}

/** 将任务结果 URL 转为本地可展示的地址（本地路径用 convertFileSrc）。 */
export function toSeedlingDisplayUrl(url: string): string {
  return url.startsWith('http') ? url : convertFileSrc(url);
}

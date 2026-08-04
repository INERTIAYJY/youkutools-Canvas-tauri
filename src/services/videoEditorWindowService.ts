/**
 * 视频剪辑独立窗口 — 打开/聚焦窗口，并在主窗口与编辑器之间传递消息
 *
 * 与 3D 导演台不同，编辑器和主窗口同源、共享同一个 IndexedDB，
 * 因此工程数据由编辑器自行读写，本服务只负责窗口生命周期与导出结果回传。
 */

export const VIDEO_EDITOR_WINDOW_LABEL = 'video-editor';
export const VIDEO_EDITOR_HOST_EVENT = 'video-editor:host-message';
export const VIDEO_EDITOR_MESSAGE_EVENT = 'video-editor:message';

export type VideoEditorProtocolMessage = {
  type: string;
  payload?: Record<string, unknown>;
};

export type VideoEditorWindowEnvelope = {
  instanceId: string;
  message: VideoEditorProtocolMessage;
};

/** 编辑器导出完成后回传给节点的结果 */
export type VideoEditorExportResult = {
  videoUrl: string;
  filePath?: string;
  fileName: string;
  duration: number;
  /** 输出尺寸，供新建节点按比例布局 */
  width?: number;
  height?: number;
};

/** 编辑器导出当前帧后回传给节点的结果 */
export type VideoEditorFrameExportResult = {
  imageUrl: string;
  filePath?: string;
  fileName: string;
  /** 帧所在的时间轴时刻（秒），用于命名新节点 */
  time: number;
  width: number;
  height: number;
};

/** 主窗口下发给编辑器的可选视频模型；编辑器不持有模型目录，只做展示与回传 */
export type VideoEditorModelOption = {
  value: string;
  label: string;
  provider: string;
  groupName: string;
};

/**
 * AI 转场请求：编辑器已把首/尾帧写进项目目录，这里只传地址。
 * 真正的模型调用在主窗口完成——独立窗口没有 Store，也读不到 API Key。
 */
export type VideoEditorAiTransitionRequest = {
  requestId: string;
  prompt: string;
  /** MediaModelOption.value，例如 "volcengine/seedance-1-0-pro" */
  model: string;
  provider: string;
  /** 期望时长（秒），交给支持该参数的模型 */
  duration?: number;
  /** 转场起点：前一段的尾帧 */
  firstFrameUrl: string;
  firstFrameFilePath?: string;
  /** 转场终点：后一段的首帧 */
  lastFrameUrl: string;
  lastFrameFilePath?: string;
};

/**
 * AI 转场结果；error 非空表示失败，编辑器直接展示。
 *
 * 刻意不带时长：请求里的 duration 只是给模型的期望值，成片长度未必一致，
 * 片段时长一律由编辑器探测素材后回填。
 */
export type VideoEditorAiTransitionResult = {
  requestId: string;
  videoUrl?: string;
  filePath?: string;
  fileName?: string;
  error?: string;
};

type Subscriber = (message: VideoEditorProtocolMessage) => void;

/** 编辑器 → 主窗口 */
const ALLOWED_VIDEO_EDITOR_MESSAGE_TYPES = new Set([
  'storyai:video-editor-ready',
  'storyai:video-editor-close',
  'storyai:video-editor-exported',
  'storyai:video-editor-frame-exported',
  'storyai:video-editor-models-request',
  'storyai:video-editor-ai-transition-request',
]);

/** 主窗口 → 编辑器 */
const ALLOWED_VIDEO_EDITOR_HOST_MESSAGE_TYPES = new Set([
  'storyai:video-editor-session',
  'storyai:video-editor-models',
  'storyai:video-editor-ai-transition-result',
]);

const subscribers = new Map<string, Set<Subscriber>>();
let mainListenerPromise: Promise<void> | null = null;
let unlistenMain: (() => void) | null = null;

const hostSubscribers = new Map<string, Set<Subscriber>>();
let hostListenerPromise: Promise<void> | null = null;
let unlistenHost: (() => void) | null = null;

function normalizeInstanceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const instanceId = value.trim();
  if (!instanceId || instanceId.length > 128) return null;
  return instanceId;
}

function parseEnvelope(
  value: unknown,
  allowedTypes: ReadonlySet<string>,
): VideoEditorWindowEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const instanceId = normalizeInstanceId(candidate.instanceId);
  if (!instanceId || !candidate.message || typeof candidate.message !== 'object') return null;
  const message = candidate.message as Record<string, unknown>;
  if (typeof message.type !== 'string') return null;
  if (!allowedTypes.has(message.type)) return null;
  if (message.payload !== undefined && (!message.payload || typeof message.payload !== 'object')) {
    return null;
  }
  return {
    instanceId,
    message: {
      type: message.type,
      ...(message.payload ? { payload: message.payload as Record<string, unknown> } : {}),
    },
  };
}

export function parseVideoEditorWindowEnvelope(value: unknown): VideoEditorWindowEnvelope | null {
  return parseEnvelope(value, ALLOWED_VIDEO_EDITOR_MESSAGE_TYPES);
}

export function parseVideoEditorHostEnvelope(value: unknown): VideoEditorWindowEnvelope | null {
  return parseEnvelope(value, ALLOWED_VIDEO_EDITOR_HOST_MESSAGE_TYPES);
}

export function isTauriVideoEditorAvailable(): boolean {
  return typeof window !== 'undefined'
    && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
}

function notifySubscribers(
  registry: Map<string, Set<Subscriber>>,
  instanceId: string,
  message: VideoEditorProtocolMessage,
) {
  for (const subscriber of registry.get(instanceId) ?? []) {
    subscriber(message);
  }
}

async function ensureMainListener(): Promise<void> {
  if (mainListenerPromise) return mainListenerPromise;
  mainListenerPromise = (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    unlistenMain = await listen<unknown>(VIDEO_EDITOR_MESSAGE_EVENT, (event) => {
      const envelope = parseVideoEditorWindowEnvelope(event.payload);
      if (envelope) notifySubscribers(subscribers, envelope.instanceId, envelope.message);
    });
  })().catch((error) => {
    mainListenerPromise = null;
    throw error;
  });
  return mainListenerPromise;
}

/** 编辑器窗口内调用：监听主窗口下发的消息 */
async function ensureHostListener(): Promise<void> {
  if (hostListenerPromise) return hostListenerPromise;
  hostListenerPromise = (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    unlistenHost = await listen<unknown>(VIDEO_EDITOR_HOST_EVENT, (event) => {
      const envelope = parseVideoEditorHostEnvelope(event.payload);
      if (envelope) notifySubscribers(hostSubscribers, envelope.instanceId, envelope.message);
    });
  })().catch((error) => {
    hostListenerPromise = null;
    throw error;
  });
  return hostListenerPromise;
}

/** 编辑器窗口的入口 URL：复用 index.html，靠 ?view= 路由 */
export function buildVideoEditorWindowUrl(params: {
  instanceId: string;
  projectId: string;
  nodeId: string;
  theme: 'dark' | 'light';
}): string {
  const search = new URLSearchParams({
    view: 'video-editor',
    instanceId: params.instanceId,
    projectId: params.projectId,
    nodeId: params.nodeId,
    theme: params.theme,
  });
  return `index.html?${search.toString()}`;
}

/** 打开（或聚焦已存在的）剪辑窗口 */
export async function openVideoEditorWindow(params: {
  instanceId: string;
  projectId: string;
  nodeId: string;
  theme?: 'dark' | 'light';
}): Promise<void> {
  const instanceId = normalizeInstanceId(params.instanceId);
  if (!instanceId) throw new Error('剪辑工程标识无效');
  if (!isTauriVideoEditorAvailable()) {
    throw new Error('视频编辑器独立窗口仅支持 Tauri 桌面端');
  }

  const theme = params.theme === 'light' ? 'light' : 'dark';
  await ensureMainListener();
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  const existing = await WebviewWindow.getByLabel(VIDEO_EDITOR_WINDOW_LABEL);
  if (existing) {
    await existing.show().catch(() => {});
    await existing.unminimize().catch(() => {});
    await existing.setFocus().catch(() => {});
    // 已开着的窗口切换到另一个节点：让编辑器自行换工程，避免重建窗口
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(VIDEO_EDITOR_WINDOW_LABEL, VIDEO_EDITOR_HOST_EVENT, {
      instanceId,
      message: {
        type: 'storyai:video-editor-session',
        payload: { instanceId, projectId: params.projectId, nodeId: params.nodeId, theme },
      },
    } satisfies VideoEditorWindowEnvelope);
    return;
  }

  const editorWindow = new WebviewWindow(VIDEO_EDITOR_WINDOW_LABEL, {
    url: buildVideoEditorWindowUrl({
      instanceId,
      projectId: params.projectId,
      nodeId: params.nodeId,
      theme,
    }),
    title: '视频编辑器',
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    center: true,
    resizable: true,
    // 与资源搜索窗口一致：无系统边框 + 透明背景，配合 CSS 圆角自绘标题栏
    decorations: false,
    transparent: true,
    shadow: false,
  });

  await new Promise<void>((resolve, reject) => {
    void editorWindow.once('tauri://created', () => resolve());
    void editorWindow.once('tauri://error', (event) => {
      reject(new Error(`创建视频编辑器窗口失败：${String(event.payload ?? 'unknown')}`));
    });
  });

  void editorWindow.once('tauri://destroyed', () => {
    notifySubscribers(subscribers, instanceId, { type: 'storyai:video-editor-close' });
  });
}

export function subscribeVideoEditorWindow(
  instanceId: string,
  subscriber: Subscriber,
): () => void {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return () => {};
  const instanceSubscribers = subscribers.get(normalizedInstanceId) ?? new Set<Subscriber>();
  instanceSubscribers.add(subscriber);
  subscribers.set(normalizedInstanceId, instanceSubscribers);
  void ensureMainListener().catch((error) => {
    console.error('[videoEditorWindow] 初始化事件监听失败:', error);
  });
  return () => {
    instanceSubscribers.delete(subscriber);
    if (instanceSubscribers.size === 0) subscribers.delete(normalizedInstanceId);
  };
}

/** 编辑器窗口内调用：把导出结果回传主窗口 */
export async function postVideoEditorExported(
  instanceId: string,
  result: VideoEditorExportResult,
): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', VIDEO_EDITOR_MESSAGE_EVENT, {
    instanceId,
    message: {
      type: 'storyai:video-editor-exported',
      payload: { ...result },
    },
  } satisfies VideoEditorWindowEnvelope);
}

/** 编辑器窗口内调用：把当前帧回传主窗口，由节点侧建图片节点 */
export async function postVideoEditorFrameExported(
  instanceId: string,
  result: VideoEditorFrameExportResult,
): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', VIDEO_EDITOR_MESSAGE_EVENT, {
    instanceId,
    message: {
      type: 'storyai:video-editor-frame-exported',
      payload: { ...result },
    },
  } satisfies VideoEditorWindowEnvelope);
}

/** 编辑器窗口内调用：通知主窗口自己已就绪 */
export async function postVideoEditorReady(instanceId: string): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', VIDEO_EDITOR_MESSAGE_EVENT, {
    instanceId,
    message: { type: 'storyai:video-editor-ready' },
  } satisfies VideoEditorWindowEnvelope);
}

/** 编辑器窗口内调用：向主窗口要一份当前可用的视频模型列表 */
export async function postVideoEditorModelsRequest(instanceId: string): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', VIDEO_EDITOR_MESSAGE_EVENT, {
    instanceId,
    message: { type: 'storyai:video-editor-models-request' },
  } satisfies VideoEditorWindowEnvelope);
}

/** 编辑器窗口内调用：请求主窗口按首/尾帧和提示词生成一段 AI 转场 */
export async function postVideoEditorAiTransitionRequest(
  instanceId: string,
  request: VideoEditorAiTransitionRequest,
): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', VIDEO_EDITOR_MESSAGE_EVENT, {
    instanceId,
    message: {
      type: 'storyai:video-editor-ai-transition-request',
      payload: { ...request },
    },
  } satisfies VideoEditorWindowEnvelope);
}

/** 编辑器窗口内调用：订阅主窗口下发的消息 */
export function subscribeVideoEditorHost(
  instanceId: string,
  subscriber: Subscriber,
): () => void {
  const normalizedInstanceId = normalizeInstanceId(instanceId);
  if (!normalizedInstanceId) return () => {};
  const instanceSubscribers = hostSubscribers.get(normalizedInstanceId) ?? new Set<Subscriber>();
  instanceSubscribers.add(subscriber);
  hostSubscribers.set(normalizedInstanceId, instanceSubscribers);
  void ensureHostListener().catch((error) => {
    console.error('[videoEditorWindow] 初始化主窗口消息监听失败:', error);
  });
  return () => {
    instanceSubscribers.delete(subscriber);
    if (instanceSubscribers.size === 0) hostSubscribers.delete(normalizedInstanceId);
  };
}

/** 主窗口内调用：把可用视频模型下发给编辑器 */
export async function postVideoEditorModels(
  instanceId: string,
  models: VideoEditorModelOption[],
): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(VIDEO_EDITOR_WINDOW_LABEL, VIDEO_EDITOR_HOST_EVENT, {
    instanceId,
    message: {
      type: 'storyai:video-editor-models',
      payload: { models },
    },
  } satisfies VideoEditorWindowEnvelope);
}

/** 主窗口内调用：把 AI 转场结果回传编辑器 */
export async function postVideoEditorAiTransitionResult(
  instanceId: string,
  result: VideoEditorAiTransitionResult,
): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(VIDEO_EDITOR_WINDOW_LABEL, VIDEO_EDITOR_HOST_EVENT, {
    instanceId,
    message: {
      type: 'storyai:video-editor-ai-transition-result',
      payload: { ...result },
    },
  } satisfies VideoEditorWindowEnvelope);
}

export function __resetVideoEditorWindowServiceForTests() {
  unlistenMain?.();
  unlistenMain = null;
  mainListenerPromise = null;
  subscribers.clear();
  unlistenHost?.();
  unlistenHost = null;
  hostListenerPromise = null;
  hostSubscribers.clear();
}

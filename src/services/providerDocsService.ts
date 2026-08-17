/**
 * 通过原生受限读取接口获取 Provider 文档，并提取标题、正文与同源候选链接。
 */
import { invoke } from '@tauri-apps/api/core';
import { normalizeProviderDocUrl } from './chat/providerDocsGrantService';
import { shouldRenderDynamicHtml } from './webPageService';

interface NativeProviderDocsResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: number;
}
export interface ProviderDocLink {
  label: string;
  url: string;
}

export interface ProviderDocsPage {
  title: string;
  url: string;
  text: string;
  links: ProviderDocLink[];
  fetchedAt: number;
  truncated: boolean;
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'FORM']);
const LINK_HINT_RE = /api|model|endpoint|reference|image|video|audio|chat|模型|接口|图片|视频|音频|对话/i;

function structuredText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'PRE') return `\n\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n`;
  const content = [...node.childNodes].map(structuredText).join('');
  return BLOCK_TAGS.has(node.tagName) ? `\n${content}\n` : content;
}

function normalizeText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHtmlPage(body: string, finalUrl: string): {
  title: string;
  text: string;
  links: ProviderDocLink[];
} {
  const parser = new DOMParser();
  const document = parser.parseFromString(body, 'text/html');
  const title = normalizeText(document.querySelector('title')?.textContent ?? '')
    || new URL(finalUrl).hostname;
  const linksByUrl = new Map<string, ProviderDocLink>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let resolved: string;
    try {
      resolved = new URL(anchor.getAttribute('href') || '', finalUrl).toString();
    } catch {
      continue;
    }
    const normalized = normalizeProviderDocUrl(resolved);
    if (!normalized || normalized.length > 512) continue;
    const label = normalizeText(anchor.textContent ?? '').slice(0, 100) || new URL(normalized).pathname;
    if (!linksByUrl.has(normalized)) linksByUrl.set(normalized, { label, url: normalized });
  }
  const root = document.querySelector('article, main') ?? document.body;
  const text = root ? normalizeText(structuredText(root)) : '';
  const links = [...linksByUrl.values()]
    .sort((left, right) => Number(LINK_HINT_RE.test(right.label + right.url))
      - Number(LINK_HINT_RE.test(left.label + left.url)));
  return { title, text, links };
}

// ---- new-api（New API）中转站识别 ----

interface NewApiPricingItem {
  model_name?: unknown;
  display_name?: unknown;
  description?: unknown;
  model_price?: unknown;
  supported_endpoint_types?: unknown;
}

export interface NewApiStatusInfo {
  systemName?: string;
  announcements: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从模型 ID、显示名与端点类型推断模型类别，返回中文标签，供模型映射到
 * text / image / video / audio 配置枚举。
 */
export function inferRelayModelCategory(item: NewApiPricingItem): string {
  const types = Array.isArray(item.supported_endpoint_types)
    ? item.supported_endpoint_types
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    : '';
  const idName = `${String(item.model_name ?? '')} ${String(item.display_name ?? '')}`.toLowerCase();
  const haystack = `${types} ${idName}`;
  if (/video|seedance|sora|veo|kling|hailuo|wan\d|skyreels|vidu|minimax/.test(haystack)) return '视频';
  if (/image|seedream|imagen|flux|banana|midjourney|recraft|dall-e|drawing/.test(haystack)) return '图片';
  if (/audio|tts|speech|music|voice|whisper|transcri/.test(haystack)) return '音频';
  return '文本';
}

/** 解析 /api/pricing 响应，返回 new-api 模型项；非 new-api 结构返回 null。 */
export function parseNewApiPricingPayload(body: string): NewApiPricingItem[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  const items = payload.data
    .filter(isRecord)
    .filter((item) => typeof item.model_name === 'string' && item.model_name.trim() !== '');
  return items.length > 0 ? (items as unknown as NewApiPricingItem[]) : null;
}

/** 解析 /api/status 响应，提取站名与公告；非 new-api 结构返回 null。 */
export function parseNewApiStatusPayload(body: string): NewApiStatusInfo | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const data = payload.data;
  const announcements = Array.isArray(data.announcements)
    ? data.announcements
      .filter(isRecord)
      .map((item) => (typeof item.content === 'string' ? item.content.trim() : ''))
      .filter(Boolean)
    : [];
  const systemName = typeof data.system_name === 'string' ? data.system_name.trim() : undefined;
  if (!systemName && announcements.length === 0) return null;
  return { systemName, announcements };
}

/** 把 new-api 模型清单与公告拼成可读文档正文。 */
export function buildRelayCatalogContent(
  rawUrl: string,
  pricing: NewApiPricingItem[],
  status: NewApiStatusInfo | null,
): { title: string; text: string } {
  const hostname = new URL(rawUrl).hostname;
  const title = status?.systemName || hostname;
  const lines = [
    `这是 new-api（New API）中转站「${title}」的公开模型清单。`,
    '该站文档页是登录后台，无法匿名读取正文；以下信息来自公开接口 /api/pricing 与 /api/status，可直接用于生成配置草稿。',
    '',
    `模型清单（共 ${pricing.length} 个）：`,
  ];
  pricing.forEach((item, index) => {
    const id = String(item.model_name ?? '').trim();
    const name = typeof item.display_name === 'string' && item.display_name.trim()
      ? item.display_name.trim()
      : id;
    const endpointTypes = Array.isArray(item.supported_endpoint_types)
      ? item.supported_endpoint_types.filter((value): value is string => typeof value === 'string')
      : [];
    lines.push(`${index + 1}. ${id}`);
    lines.push(`   显示名：${name}`);
    lines.push(`   类型：${inferRelayModelCategory(item)}`);
    if (endpointTypes.length > 0) lines.push(`   端点类型：${endpointTypes.join('、')}`);
    if (typeof item.model_price === 'number') lines.push(`   价格：¥${item.model_price}/次`);
    if (typeof item.description === 'string' && item.description.trim()) {
      lines.push(`   说明：${item.description.trim().replace(/\s+/g, ' ')}`);
    }
  });
  if (status && status.announcements.length > 0) {
    lines.push('', '站内公告（来源 /api/status，含最新模型与请求提示）：');
    for (const announcement of status.announcements.slice(0, 15)) {
      const condensed = normalizeText(announcement).slice(0, 400);
      if (condensed) lines.push(`- ${condensed}`);
    }
  }
  lines.push(
    '',
    '接口调用格式参考（new-api 公开约定，供生成配置草稿）：',
    '- 文本模型（端点含 chat/completion）：POST /v1/chat/completions，OpenAI 标准 {model, messages} 格式。',
    '- 图片模型（端点含 image-generation）：POST /v1/images/generations，OpenAI 标准 {model, prompt, size, n} 格式；支持图生图时请求体再加 image_urls（公网 HTTPS 图片 URL 数组），并把 imageReferenceRequestMode 设为 generation-json-image-urls。',
    '- 视频模型（端点含 video）：POST /v1/videos，请求体含 model、prompt、duration、resolution、size（宽高比）；参考素材按该站文档实际字段填写：普通参考图用 image_urls，首尾帧用 first_frame_image / last_frame_image，Seedance 2.x 用 image_with_roles（[{url, role}]，role 取 first_frame / last_frame / reference_image）；异步任务返回任务 ID，用 /v1/videos/{任务ID} 轮询结果。',
    '- 音频模型（端点含 audio/tts/speech）：POST /v1/audio/speech，OpenAI 标准 {model, input, voice} 格式。',
    '示例里的参数字段名要按该站真实文档写，本项目会按字段名把画布上的分辨率、宽高比、时长、数量与连线的参考素材映射进去；参考素材字段缺失就等于该模型不接参考图。',
  );
  return { title, text: lines.join('\n') };
}

async function probeNewApiPricing(
  origin: string,
  signal?: AbortSignal,
): Promise<NewApiPricingItem[] | null> {
  if (signal?.aborted) return null;
  try {
    const response = await invoke<NativeProviderDocsResponse>(
      'provider_docs_read',
      { url: `${origin}/api/pricing` },
    );
    if (!response.contentType.startsWith('application/json')) return null;
    return parseNewApiPricingPayload(response.body);
  } catch {
    return null;
  }
}

async function probeNewApiStatus(
  origin: string,
  signal?: AbortSignal,
): Promise<NewApiStatusInfo | null> {
  if (signal?.aborted) return null;
  try {
    const response = await invoke<NativeProviderDocsResponse>(
      'provider_docs_read',
      { url: `${origin}/api/status` },
    );
    if (!response.contentType.startsWith('application/json')) return null;
    return parseNewApiStatusPayload(response.body);
  } catch {
    return null;
  }
}

async function readNewApiRelayCatalog(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<ProviderDocsPage | null> {
  const origin = new URL(rawUrl).origin;
  const pricing = await probeNewApiPricing(origin, signal);
  if (!pricing) return null;
  const status = await probeNewApiStatus(origin, signal);
  const content = buildRelayCatalogContent(rawUrl, pricing, status);
  return {
    title: content.title,
    url: rawUrl,
    text: content.text,
    links: [],
    fetchedAt: Date.now(),
    truncated: false,
  };
}

export async function readProviderDocsPage(
  rawUrl: string,
  options: { signal?: AbortSignal; maxTextChars?: number } = {},
): Promise<ProviderDocsPage> {
  const normalized = normalizeProviderDocUrl(rawUrl);
  if (!normalized) throw new Error('厂商文档 URL 未通过本地安全校验');
  if (typeof window === 'undefined' || !('__TAURI__' in window)) {
    throw new Error('厂商文档读取仅在 Tauri 桌面环境可用');
  }
  if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  let response = await invoke<NativeProviderDocsResponse>('provider_docs_read', { url: normalized });
  if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  let finalUrl = normalizeProviderDocUrl(response.url);
  if (!finalUrl || new URL(finalUrl).origin !== new URL(normalized).origin) {
    throw new Error('厂商文档最终地址未通过同站安全校验');
  }

  let extracted = response.contentType.startsWith('application/json')
    ? { title: new URL(finalUrl).hostname, text: normalizeText(response.body), links: [] }
    : extractHtmlPage(response.body, finalUrl);

  // 登录后台 SPA（如 new-api 中转站）读不到正文时，改读公开模型清单与公告。
  if (!extracted.text) {
    const relay = await readNewApiRelayCatalog(finalUrl, options.signal);
    if (relay) {
      const limit = Math.max(1, Math.min(options.maxTextChars ?? 10_000, 10_000));
      return { ...relay, text: relay.text.slice(0, limit), truncated: relay.text.length > limit };
    }
  }

  // 非中转站的公开 SPA 文档站走受控渲染回退。
  if (!extracted.text && shouldRenderDynamicHtml(response.body, response.contentType, extracted.text)) {
    response = await invoke<NativeProviderDocsResponse>('assistant_web_render', { url: finalUrl });
    if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    const renderedUrl = normalizeProviderDocUrl(response.url);
    if (!renderedUrl || new URL(renderedUrl).origin !== new URL(normalized).origin) {
      throw new Error('厂商文档渲染后的最终地址未通过同站安全校验');
    }
    finalUrl = renderedUrl;
    extracted = response.contentType.startsWith('application/json')
      ? { title: new URL(finalUrl).hostname, text: normalizeText(response.body), links: [] }
      : extractHtmlPage(response.body, finalUrl);
  }

  if (!extracted.text) {
    throw new Error(
      '厂商文档页面没有可读取的正文；该页面可能是需要登录的后台 SPA，无法匿名读取。'
      + '请改用公开的模型清单/状态接口，或请用户直接提供模型列表与请求示例，不要重复读取同一地址。',
    );
  }
  const limit = Math.max(1, Math.min(options.maxTextChars ?? 10_000, 10_000));
  return {
    title: extracted.title,
    url: finalUrl,
    text: extracted.text.slice(0, limit),
    links: extracted.links.slice(0, 24),
    fetchedAt: response.fetchedAt,
    truncated: extracted.text.length > limit,
  };
}

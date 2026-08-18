/**
 * Seedling（森之灵）视频 Provider Adapter
 *
 * 通过 Seedling CLI 提交视频生成任务并轮询结果：
 *   - task create（参数白名单由 Rust 侧校验）→ 立即返回 taskId
 *   - task get 轮询直至 succeeded / failed / expired / cancelled
 *   - 结果返回 videoUrl（线上地址），由上层 downloadUrlAndSave 统一落盘
 *
 * 参考素材规则（与项目 assignVideoReferenceRoles 语义一致）：
 *   - 显式首/尾帧时按 首帧 → 参考 → 尾帧 排序，全部走 CLI --resource
 *   - 本地绝对路径直接交给 CLI（CLI 自动上传）；asset/blob/data URL 经通用图床转公网
 */
import type { VideoGenerationReferenceInput } from '../../../types/aiTypes';
import { extractModelName } from '../helpers';
import { getMediaReferenceUrl } from '../connectedReferenceMedia';
import { resolveMediaReferenceUrl, uploadToRemote } from '../../uploadService';
import {
  createSeedlingVideoTask,
  toSeedlingDisplayUrl,
  uploadSeedlingResource,
  waitSeedlingTask,
} from '../../seedlingService';
import { useAppStore } from '../../../store/useAppStore';
import type { MediaProviderAdapter } from '../mediaProviderRegistry';

/**
 * 生成前认证预检：API Token（config.providers.seedling.apiKey）或 CLI 登录态
 * （config.seedlingAuth.loggedIn 镜像，由设置页刷新写入）任一可用。
 * 二者皆无时给出明确引导，而不是把 CLI 的原始报错透传给用户。
 */
function assertSeedlingAuthorized(): void {
  const config = useAppStore.getState().config;
  const hasToken = Boolean(config.providers?.seedling?.apiKey);
  const cliLoggedIn = Boolean(config.seedlingAuth?.loggedIn);
  if (!hasToken && !cliLoggedIn) {
    throw new Error(
      '森之灵未完成认证：请在「设置 → 森之灵」中完成 CLI 浏览器授权登录（确认配对码），'
      + '或填写 API Token 后重试',
    );
  }
}

/** Seedling CLI 时长下限（秒）；项目通用下限为 2，需在提交前钳制。 */
const SEEDLING_MIN_DURATION = 4;
const SEEDLING_MAX_DURATION = 15;

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** 本地磁盘绝对路径（Windows 盘符或 Unix 根路径）。 */
function isLocalDiskPath(value: string): boolean {
  const t = value.trim();
  if (!t || isPublicHttpUrl(t)) return false;
  if (
    t.startsWith('asset.localhost')
    || t.startsWith('blob:')
    || t.startsWith('data:')
    || t.startsWith('file://')
  ) {
    return false;
  }
  return t.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(t);
}

/**
 * 从 Tauri 资产协议 URL（http://asset.localhost/<encoded-path>）解码出本地磁盘路径。
 * 例：http://asset.localhost/C%3A%2FUsers%2F...%2Fa.mp4 → C:\Users\...\a.mp4
 */
function decodeAssetLocalPath(url: string): string | undefined {
  const marker = 'asset.localhost/';
  const idx = url.indexOf(marker);
  if (idx < 0) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.slice(idx + marker.length));
  } catch {
    return undefined;
  }
  // Windows 盘符形式（/C:/... 或 C:/...）→ C:\...
  const withoutLead = decoded.replace(/^\/+/, '');
  if (/^[a-zA-Z]:[\\/]/.test(withoutLead)) {
    return withoutLead.replace(/\//g, '\\');
  }
  return decoded;
}

/**
 * 把参考 URL 规范化为 CLI `--resource` 可用的值。
 * Seedling CLI 的 `--resource` 只接受 `https://` 开头的 URL：
 *   - https 直传
 *   - asset.localhost 资产协议：解码本地路径后经 `resource upload` 上传为 https
 *     （视频/音频/图片通用；上传失败回退通用图床）
 *   - http 远程图：读取后经通用图床转为 https（CLI 不接收 http）
 *   - 本地磁盘路径：先用 `seedling resource upload` 上传拿到 https 在线地址
 *   - blob / data：统一经通用图床转公网 https URL
 */
async function toCliResource(
  url: string,
  kind: 'image' | 'video' | 'audio' = 'image',
): Promise<string | undefined> {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https:\/\//i.test(trimmed)) return trimmed;

  if (trimmed.includes('asset.localhost')) {
    const localPath = decodeAssetLocalPath(trimmed);
    if (localPath) {
      try {
        const { url: uploaded } = await uploadSeedlingResource(localPath);
        return uploaded;
      } catch {
        // 上传失败（路径未授权等）→ 回退通用图床
      }
    }
    return resolveMediaReferenceUrl(trimmed, { kind });
  }

  if (/^http:\/\//i.test(trimmed)) {
    try {
      return await uploadToRemote(trimmed);
    } catch (error) {
      throw new Error(
        `森之灵无法访问 http 参考图（需 https 地址）：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  if (isLocalDiskPath(trimmed)) {
    try {
      const { url: uploaded } = await uploadSeedlingResource(trimmed);
      return uploaded;
    } catch (error) {
      throw new Error(
        `森之灵素材上传失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  return resolveMediaReferenceUrl(trimmed, { kind });
}

function rankImageReference(role: string | undefined): number {
  if (role === 'first_frame') return 0;
  if (role === 'last_frame') return 2;
  return 1;
}

/** 收集参考媒体为 CLI --resource 列表：图片按角色排序，视频/音频参考转公网后追加。 */
async function collectSeedlingResources(
  referenceInput: VideoGenerationReferenceInput,
): Promise<string[]> {
  const resources: string[] = [];
  const seen = new Set<string>();

  const references = referenceInput.references ?? [];
  const hasExplicitFrames = references.some(
    (ref) => ref.kind === 'image' && (ref.role === 'first_frame' || ref.role === 'last_frame'),
  );

  const imageUrls = hasExplicitFrames
    ? references
      .filter((ref) => ref.kind === 'image')
      .sort((a, b) => rankImageReference(a.role) - rankImageReference(b.role))
      .map((ref) => getMediaReferenceUrl(ref))
    : referenceInput.imageUrls;

  for (const url of imageUrls) {
    const resolved = await toCliResource(url);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      resources.push(resolved);
    }
  }

  for (const url of referenceInput.videoUrls) {
    const resolved = await toCliResource(url, 'video');
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      resources.push(resolved);
    }
  }
  for (const url of referenceInput.audioUrls) {
    const resolved = await toCliResource(url, 'audio');
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      resources.push(resolved);
    }
  }

  // 兜底校验：CLI 的 --resource 只接受 https:// URL，任何非 https 资源都会导致
  // 「资源 URL 必须以 https:// 开头」的 VALIDATION_ERROR。这里提前拦截并指明违规项。
  const invalid = resources.find((url) => !/^https:\/\//i.test(url));
  if (invalid) {
    throw new Error(
      `森之灵参考素材必须是 https:// 地址，当前存在无法识别的资源：${invalid}`,
    );
  }

  return resources;
}

export const seedlingMediaProviderAdapter: MediaProviderAdapter = {
  providerId: 'seedling',
  capabilities: ['video'],

  async generateVideo({ params, prompt, resolveReferenceInput, signal }) {
    assertSeedlingAuthorized();
    const referenceInput = await resolveReferenceInput();
    const resources = await collectSeedlingResources(referenceInput);

    const duration = Number.isFinite(params.seedanceDuration)
      ? Math.min(
        SEEDLING_MAX_DURATION,
        Math.max(SEEDLING_MIN_DURATION, Math.round(Number(params.seedanceDuration))),
      )
      : undefined;

    const { taskId } = await createSeedlingVideoTask({
      prompt: referenceInput.prompt || prompt,
      model: extractModelName(params.model, params.provider),
      duration,
      resolution: params.seedanceResolution,
      ratio: params.seedanceRatio,
      audio: params.generateAudio,
      resources,
    });

    const task = await waitSeedlingTask(taskId, signal);
    if (!task.videoUrl) {
      throw new Error(task.errorMessage || 'Seedling 未返回视频结果');
    }
    return { url: toSeedlingDisplayUrl(task.videoUrl) };
  },
};

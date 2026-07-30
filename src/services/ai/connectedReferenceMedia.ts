/**
 * ai/connectedReferenceMedia — 收集连入某个生成节点的参考媒体。
 * 视频与音频生成共用：连线即引用，图片包含 3D 导演台截图。
 */
import { useAppStore } from '../../store/useAppStore';
import { collectDirectorImageUrls } from '../directorDeskService';
import type { BaseNodeData } from '../../types';
import type { MediaReference, MediaReferenceKind } from '../../types/aiTypes';

export interface ConnectedReferenceMedia {
  references: MediaReference[];
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
}

function isRemoteUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) && !value.includes('asset.localhost');
}

/** 远端模型优先复用生成结果原始公网 URL，本地工作流仍可直接读取 reference.url。 */
export function getMediaReferenceUrl(reference: MediaReference): string {
  return isRemoteUrl(reference.sourceUrl) ? reference.sourceUrl.trim() : reference.url;
}

export function getMediaReferenceUrls(
  references: readonly MediaReference[],
  kind: MediaReferenceKind,
  target: 'remote' | 'local' = 'remote',
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    if (reference.kind !== kind) continue;
    pushUniqueUrl(urls, seen, target === 'local' ? reference.url : getMediaReferenceUrl(reference));
  }
  return urls;
}

export function mergeMediaReferences(
  primary: readonly MediaReference[],
  additional: readonly MediaReference[],
): MediaReference[] {
  const references: MediaReference[] = [];
  const seen = new Set<string>();
  for (const reference of [...primary, ...additional]) {
    const url = reference.url.trim();
    const key = `${reference.kind}:${url}`;
    if (!url || seen.has(key)) continue;
    seen.add(key);
    references.push({ ...reference, url });
  }
  return references;
}

export function toLegacyReferenceMedia(references: readonly MediaReference[]): ConnectedReferenceMedia {
  return {
    references: [...references],
    imageUrls: getMediaReferenceUrls(references, 'image'),
    videoUrls: getMediaReferenceUrls(references, 'video'),
    audioUrls: getMediaReferenceUrls(references, 'audio'),
  };
}

export function pushUniqueUrl(urls: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const url = value.trim();
  if (!url || seen.has(url)) return;
  seen.add(url);
  urls.push(url);
}

export function mergeUniqueUrls(primary: string[], additional: string[]): string[] {
  const urls = [...primary];
  const seen = new Set(urls);
  for (const url of additional) pushUniqueUrl(urls, seen, url);
  return urls;
}

export function collectConnectedReferenceMedia(nodeId: string | undefined): ConnectedReferenceMedia {
  const empty: ConnectedReferenceMedia = { references: [], imageUrls: [], videoUrls: [], audioUrls: [] };
  if (!nodeId) return empty;
  const { nodes, edges } = useAppStore.getState();
  const sourceIds = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  const references: MediaReference[] = [];

  const addReference = (
    kind: MediaReferenceKind,
    value: unknown,
    sourceNodeId: string,
    data: BaseNodeData,
  ) => {
    if (typeof value !== 'string' || !value.trim()) return;
    references.push({
      kind,
      url: value.trim(),
      origin: 'connection',
      role: kind === 'audio' ? 'reference_audio' : 'reference',
      sourceNodeId,
      filePath: data.filePath,
      sourceUrl: data.sourceUrl,
    });
  };

  for (const sid of sourceIds) {
    const node = nodes.find((n) => n.id === sid);
    if (!node) continue;
    const data = node.data as BaseNodeData;
    const type = (data.type as string) || node.type || '';
    if (type === 'ai-director') {
      for (const url of collectDirectorImageUrls(data)) {
        addReference('image', url, sid, data);
      }
      continue;
    }
    if (
      type === 'ai-image'
      || type === 'source-image'
      || type === 'ai-panorama'
      || type === 'ai-storyboard'
    ) {
      addReference('image', data.imageUrl || data.thumbnailUrl, sid, data);
      continue;
    }
    addReference('video', data.videoUrl, sid, data);
    addReference('audio', data.audioUrl, sid, data);
  }
  return toLegacyReferenceMedia(mergeMediaReferences([], references));
}

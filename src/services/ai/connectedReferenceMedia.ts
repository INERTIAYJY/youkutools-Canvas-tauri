/**
 * ai/connectedReferenceMedia — 收集连入某个生成节点的参考媒体。
 * 视频与音频生成共用：连线即引用，图片包含 3D 导演台截图。
 */
import { useAppStore } from '../../store/useAppStore';
import { collectDirectorImageUrls } from '../directorDeskService';
import type { BaseNodeData } from '../../types';

export interface ConnectedReferenceMedia {
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
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
  const empty: ConnectedReferenceMedia = { imageUrls: [], videoUrls: [], audioUrls: [] };
  if (!nodeId) return empty;
  const { nodes, edges } = useAppStore.getState();
  const sourceIds = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  const media: ConnectedReferenceMedia = { imageUrls: [], videoUrls: [], audioUrls: [] };
  const imageSeen = new Set<string>();
  const videoSeen = new Set<string>();
  const audioSeen = new Set<string>();
  for (const sid of sourceIds) {
    const node = nodes.find((n) => n.id === sid);
    if (!node) continue;
    const data = node.data as BaseNodeData;
    const type = (data.type as string) || node.type || '';
    if (type === 'ai-director') {
      for (const url of collectDirectorImageUrls(data)) {
        pushUniqueUrl(media.imageUrls, imageSeen, url);
      }
      continue;
    }
    if (
      type === 'ai-image'
      || type === 'source-image'
      || type === 'ai-panorama'
      || type === 'ai-storyboard'
    ) {
      pushUniqueUrl(media.imageUrls, imageSeen, data.imageUrl || data.thumbnailUrl);
      continue;
    }
    pushUniqueUrl(media.videoUrls, videoSeen, data.videoUrl);
    pushUniqueUrl(media.audioUrls, audioSeen, data.audioUrl);
  }
  return media;
}

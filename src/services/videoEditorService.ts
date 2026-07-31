/**
 * 剪辑编排 — 主窗口侧：从视频/图片节点建立或复用剪辑工程并打开独立窗口
 *
 * 工程先落 IndexedDB 再开窗，编辑器按工程 ID 自行取回；
 * 两个窗口同源共享同一个库，因此不需要额外的素材交接通道。
 */
import type { BaseNodeData, NodeType } from '../types';
import {
  DEFAULT_IMAGE_CLIP_DURATION,
  VIDEO_EDITOR_SCHEMA_VERSION,
  relayoutSequential,
  type VideoEditorClip,
  type VideoEditorProjectRecord,
} from '../types/videoEditor';
import {
  buildVideoEditorProjectId,
  getVideoEditorProject,
  saveVideoEditorProject,
} from './indexedDbService';
import { openVideoEditorWindow } from './videoEditorWindowService';

/** 可进入剪辑时间轴的节点类型 */
const VIDEO_NODE_TYPES: NodeType[] = ['ai-video', 'source-video'];
const IMAGE_NODE_TYPES: NodeType[] = ['ai-image', 'source-image'];

export interface EditableMediaNode {
  id: string;
  type?: string;
  data: BaseNodeData;
}

/** 判断节点是否具备可编辑的视频素材 */
export function canEditNodeVideo(data: BaseNodeData | undefined): boolean {
  if (!data) return false;
  return !!(data.filePath || data.videoUrl);
}

/** 判断节点能否作为剪辑素材（视频必需，图片可选参与） */
export function isEditableMediaNode(node: EditableMediaNode | undefined): boolean {
  if (!node?.data) return false;
  const type = node.type as NodeType | undefined;
  if (type && VIDEO_NODE_TYPES.includes(type)) {
    return !!(node.data.filePath || node.data.videoUrl);
  }
  if (type && IMAGE_NODE_TYPES.includes(type)) {
    return !!(node.data.filePath || node.data.imageUrl);
  }
  return false;
}

/** 至少要有一个视频素材，纯图片序列一期不支持导出 */
export function hasVideoSource(nodes: EditableMediaNode[]): boolean {
  return nodes.some((node) => {
    const type = node.type as NodeType | undefined;
    return !!type && VIDEO_NODE_TYPES.includes(type);
  });
}

function buildClip(node: EditableMediaNode, index: number): VideoEditorClip {
  const type = node.type as NodeType | undefined;
  const isImage = !!type && IMAGE_NODE_TYPES.includes(type);
  const data = node.data;
  const fallbackName = (typeof data.label === 'string' && data.label) || '素材';

  return {
    id: `clip-${index + 1}-${node.id}`,
    kind: isImage ? 'image' : 'video',
    filePath: data.filePath,
    assetId: data.assetId,
    sourceUrl: isImage ? data.imageUrl : data.videoUrl,
    fileName: (typeof data.fileName === 'string' && data.fileName) || fallbackName,
    nodeId: node.id,
    timelineStart: 0,
    sourceIn: 0,
    // 图片按固定停留时长；视频时长未知时置 0，由编辑器探测后回填
    sourceOut: isImage
      ? DEFAULT_IMAGE_CLIP_DURATION
      : (typeof data.videoDuration === 'number' && data.videoDuration > 0
        ? data.videoDuration
        : 0),
  };
}

/**
 * 打开一批素材节点对应的剪辑工程。
 *
 * 工程锚定在第一个节点上：ID 由它决定，导出结果也回写到它。
 * 已有工程则直接复用（保留上次的裁剪与分割结果），不会被重新打开覆盖。
 */
export async function openVideoEditorForNodes(params: {
  projectId: string;
  nodes: EditableMediaNode[];
  theme?: 'dark' | 'light';
}): Promise<void> {
  const { projectId, nodes, theme } = params;
  if (!projectId) throw new Error('请先打开一个项目再编辑视频');

  const usable = nodes.filter(isEditableMediaNode);
  if (usable.length === 0) throw new Error('选中的节点没有可编辑的素材');
  if (!hasVideoSource(usable)) throw new Error('至少需要选中一个视频节点');

  const anchor = usable[0];
  const id = buildVideoEditorProjectId(projectId, anchor.id);
  const existing = await getVideoEditorProject(id);

  if (existing) {
    // 锚点节点可能已有旧工程（例如之前单独打开过）。这次选择里多出来的素材
    // 要追加进时间轴，否则用户多选了却只看到旧的那一个片段；
    // 追加而非重建，是为了保住已有的裁剪与分割结果。
    const known = new Set(existing.nodeIds ?? [existing.nodeId]);
    const missing = usable.filter((node) => !known.has(node.id));

    if (missing.length > 0) {
      const videoTrack = existing.tracks.find((track) => track.kind === 'video');
      const offset = videoTrack?.clips.length ?? 0;
      const appended = [
        ...(videoTrack?.clips ?? []),
        ...missing.map((node, index) => buildClip(node, offset + index)),
      ];
      await saveVideoEditorProject({
        ...existing,
        nodeIds: [...(existing.nodeIds ?? [existing.nodeId]), ...missing.map((node) => node.id)],
        tracks: existing.tracks.map((track) => (
          track.kind === 'video' ? { ...track, clips: relayoutSequential(appended) } : track
        )),
        updatedAt: Date.now(),
      });
    }
  } else {
    const now = Date.now();
    const anchorName = (typeof anchor.data.label === 'string' && anchor.data.label)
      || (typeof anchor.data.fileName === 'string' && anchor.data.fileName)
      || '未命名剪辑';
    const name = usable.length > 1 ? `${anchorName} 等 ${usable.length} 个素材` : anchorName;

    const record: VideoEditorProjectRecord = {
      id,
      schemaVersion: VIDEO_EDITOR_SCHEMA_VERSION,
      projectId,
      nodeId: anchor.id,
      nodeIds: usable.map((node) => node.id),
      name,
      tracks: [{
        id: 'video-1',
        kind: 'video',
        name: '视频轨 1',
        clips: relayoutSequential(usable.map(buildClip)),
      }],
      createdAt: now,
      updatedAt: now,
    };
    await saveVideoEditorProject(record);
  }

  await openVideoEditorWindow({ instanceId: id, projectId, nodeId: anchor.id, theme });
}

/** 单节点入口，保留给只右键一个视频节点的场景 */
export async function openVideoEditorForNode(params: {
  projectId: string;
  nodeId: string;
  data: BaseNodeData;
  type?: string;
  theme?: 'dark' | 'light';
}): Promise<void> {
  if (!canEditNodeVideo(params.data)) throw new Error('该节点没有可编辑的视频素材');
  await openVideoEditorForNodes({
    projectId: params.projectId,
    nodes: [{ id: params.nodeId, type: params.type ?? 'ai-video', data: params.data }],
    theme: params.theme,
  });
}

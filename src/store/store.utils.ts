/**
 * Store utilities — pure functions: ID generation, image dimension calculation
 */
import type { Node } from '@xyflow/react';
import type { BaseNodeData } from '../types';

export const generateId = () => Math.random().toString(36).substring(2, 11);

export function generateProjectId(): string {
  return crypto.randomUUID();
}

export function computeImageNodeDimensions(dataUrl: string): Promise<{ nodeWidth: number; nodeHeight: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const naturalRatio = img.naturalWidth / img.naturalHeight;
      const maxWidth = 280;
      const minWidth = 160;
      let nodeWidth = img.naturalWidth;
      if (nodeWidth > maxWidth) nodeWidth = maxWidth;
      if (nodeWidth < minWidth) nodeWidth = minWidth;
      const contentWidth = nodeWidth - 4;
      const previewHeight = Math.round(contentWidth / naturalRatio);
      const nodeHeight = Math.max(120, previewHeight + 4);
      resolve({ nodeWidth, nodeHeight });
    };
    img.onerror = () => resolve({ nodeWidth: 280, nodeHeight: 158 });
    img.src = dataUrl;
  });
}

/**
 * 派生节点统一放在源节点右侧。
 * 源节点在分组里时坐标是相对父节点的，必须把 parentId 一起继承，
 * 否则同一份坐标落到画布原点系里，节点会跑到离源节点很远的地方。
 */
export function derivedNodePlacement(
  sourceNode: Pick<Node<BaseNodeData>, 'position' | 'parentId' | 'data'>,
  gap = 40,
): { position: { x: number; y: number }; parentId?: string } {
  const width = Number(sourceNode.data?.nodeWidth) || 280;
  return {
    position: { x: sourceNode.position.x + width + gap, y: sourceNode.position.y },
    ...(sourceNode.parentId ? { parentId: sourceNode.parentId } : {}),
  };
}

export function getNextDisplayId(nodes: Node<BaseNodeData>[]): number {
  let max = 9;
  for (const n of nodes) {
    const id = (n.data as BaseNodeData).displayId;
    if (typeof id === 'number' && id > max) max = id;
  }
  return max + 1;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

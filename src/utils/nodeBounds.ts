/**
 * nodeBounds — 节点包围盒计算工具，供对齐/吸附等功能复用
 */
import type { Node as RFNode } from '@xyflow/react';
import type { BaseNodeData } from '../types';

type NodeLookup = RFNode<BaseNodeData>[] | ReadonlyMap<string, RFNode<BaseNodeData>>;

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
}

function getDefaultNodeSize(nodeType: string | undefined): { width: number; height: number } {
  switch (nodeType) {
    case 'source-text':
    case 'ai-text':   return { width: 280, height: 160 };
    case 'source-image':
    case 'ai-image':  return { width: 280, height: 158 };
    case 'source-video':
    case 'ai-video':  return { width: 280, height: 160 };
    case 'source-audio':
    case 'ai-audio':  return { width: 260, height: 140 };
    default:          return { width: 280, height: 160 };
  }
}

function resolveNodeDimension(node: RFNode<BaseNodeData>, axis: 'width' | 'height'): number | undefined {
  const styleSize = node.style?.[axis];
  return [
    node.measured?.[axis],
    node[axis],
    node[axis === 'width' ? 'initialWidth' : 'initialHeight'],
    typeof styleSize === 'string' ? Number(styleSize.trim().replace(/px$/, '')) : styleSize,
    node.data?.[axis === 'width' ? 'nodeWidth' : 'nodeHeight'],
    node.type === 'canvas-note' ? node.data?.note?.[axis] : undefined,
  ].find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/**
 * 显示边界逐轴采用有效实测值；未实测时按 React Flow 显式尺寸、像素样式、业务尺寸估算。
 * 初始尺寸只在缺少实测值时参与回退；相对 CSS 尺寸无法脱离容器求值，沿用类型兜底。
 * 只读几何，不将估算写回节点，也不用于主动重排或折叠时指定新的目标尺寸。
 */
export function getNodeSize(node: RFNode<BaseNodeData>): { width: number; height: number } {
  const fallback = getDefaultNodeSize(node.type ?? node.data?.type);
  return {
    width: resolveNodeDimension(node, 'width') ?? fallback.width,
    height: resolveNodeDimension(node, 'height') ?? fallback.height,
  };
}

/**
 * 生成前按画面比例预估节点框高度：图片还没出来，只能用比例把固定宽度的卡片撑开。
 * 4px 是卡片边框，min 保证竖排比例下不会矮到看不见标题。
 */
export function nodeHeightForAspectRatio(
  aspectRatio: string,
  nodeWidth = 280,
  min = 160,
): number {
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w && h ? w / h : 1;
  return Math.max(min, Math.round((nodeWidth - 4) / ratio) + 4);
}

/** 空视频框保持当前宽度并匹配生成比例；自适应或未指定比例不推测尺寸。 */
export function videoNodeDimensionsForAspectRatio(
  aspectRatio: string | undefined,
  nodeWidth = 280,
): { nodeWidth: number; nodeHeight: number } | null {
  const parts = aspectRatio?.split(':');
  if (parts?.length !== 2) return null;
  const [width, height] = parts.map(Number);
  const nodeHeight = Math.round(nodeWidth * height / width);
  if (![width, height, nodeWidth, nodeHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { nodeWidth, nodeHeight };
}

/** 每个祖先只累加一次；遇到当前节点、重复祖先或缺失父级时停止，不修复原父链。 */
export function getParentOffset(
  node: RFNode<BaseNodeData>,
  allNodes: NodeLookup,
): { x: number; y: number } {
  let offsetX = 0;
  let offsetY = 0;
  const visited = new Set([node.id]);
  let pid: string | undefined = node.parentId;
  while (pid && !visited.has(pid)) {
    visited.add(pid);
    const p = Array.isArray(allNodes) ? allNodes.find((n) => n.id === pid) : allNodes.get(pid);
    if (!p) break;
    offsetX += p.position.x;
    offsetY += p.position.y;
    pid = p.parentId;
  }
  return { x: offsetX, y: offsetY };
}

/** Get absolute bounds for a node (accounting for parent group offsets) */
export function getNodeBounds(
  node: RFNode<BaseNodeData>,
  allNodes: NodeLookup,
): NodeBounds {
  const { width: cardWidth, height: cardHeight } = getNodeSize(node);
  const parentOffset = node.parentId ? getParentOffset(node, allNodes) : { x: 0, y: 0 };
  const x = node.position.x + parentOffset.x;
  const y = node.position.y + parentOffset.y;
  return {
    x,
    y,
    width: cardWidth,
    height: cardHeight,
    left: x,
    centerX: x + cardWidth / 2,
    right: x + cardWidth,
    top: y,
    centerY: y + cardHeight / 2,
    bottom: y + cardHeight,
  };
}

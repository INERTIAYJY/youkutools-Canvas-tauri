/**
 * composerGeometry — 合成器里依赖 Konva 实测包围盒的几何计算
 *
 * 对齐与吸附都要考虑旋转/缩放后的真实外框，所以统一用
 * node.getClientRect({ relativeTo: 图层根 })，得到的就是画布页面坐标。
 */
import type Konva from 'konva';
import type { AlignDir } from '../../../../../types/composerTypes';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuides {
  /** 命中的竖向参考线 x（页面坐标），未命中为 null */
  v: number | null;
  /** 命中的横向参考线 y */
  h: number | null;
}

export const NO_GUIDES: SnapGuides = { v: null, h: null };

/** 节点在页面坐标系下的外接矩形 */
export function pageRect(node: Konva.Node): Box {
  const root = node.getLayer();
  return node.getClientRect(root ? { relativeTo: root } : undefined);
}

/** 找出 mine 中任一边/中线与 targets 的最近命中 */
function nearest(mine: number[], targets: number[], threshold: number): { delta: number; line: number | null } {
  let delta = Infinity;
  let line: number | null = null;
  for (const m of mine) {
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) < Math.abs(delta)) {
        delta = d;
        line = t;
      }
    }
  }
  return Math.abs(delta) <= threshold ? { delta, line } : { delta: 0, line: null };
}

/**
 * 拖拽吸附：把 node 贴到画布边/中线或其它图层的边/中线上（就地修改 node 位置）。
 * 返回命中的参考线，供画面绘制提示。
 */
export function snapDuringDrag(
  node: Konva.Node,
  others: Konva.Node[],
  canvas: { width: number; height: number },
  threshold: number,
): SnapGuides {
  const box = pageRect(node);
  const vTargets = [0, canvas.width / 2, canvas.width];
  const hTargets = [0, canvas.height / 2, canvas.height];
  for (const other of others) {
    const r = pageRect(other);
    vTargets.push(r.x, r.x + r.width / 2, r.x + r.width);
    hTargets.push(r.y, r.y + r.height / 2, r.y + r.height);
  }

  const v = nearest([box.x, box.x + box.width / 2, box.x + box.width], vTargets, threshold);
  const h = nearest([box.y, box.y + box.height / 2, box.y + box.height], hTargets, threshold);
  if (v.delta) node.x(node.x() + v.delta);
  if (h.delta) node.y(node.y() + h.delta);
  return { v: v.line, h: h.line };
}

/** 相对画布对齐：返回图层 x/y 需要的增量 */
export function alignOffset(
  node: Konva.Node,
  canvas: { width: number; height: number },
  dir: AlignDir,
): { dx: number; dy: number } {
  const box = pageRect(node);
  switch (dir) {
    case 'left': return { dx: -box.x, dy: 0 };
    case 'hcenter': return { dx: canvas.width / 2 - (box.x + box.width / 2), dy: 0 };
    case 'right': return { dx: canvas.width - (box.x + box.width), dy: 0 };
    case 'top': return { dx: 0, dy: -box.y };
    case 'vcenter': return { dx: 0, dy: canvas.height / 2 - (box.y + box.height / 2) };
    case 'bottom': return { dx: 0, dy: canvas.height - (box.y + box.height) };
    default: return { dx: 0, dy: 0 };
  }
}

/**
 * 相对当前外框，铺满画布所需的缩放倍数。
 * contain = 完整放入（可能留边），cover = 铺满（可能出血）。
 */
export function fitScaleFactor(
  node: Konva.Node,
  canvas: { width: number; height: number },
  mode: 'contain' | 'cover',
): number {
  const box = pageRect(node);
  if (box.width <= 0 || box.height <= 0) return 1;
  const rx = canvas.width / box.width;
  const ry = canvas.height / box.height;
  return mode === 'cover' ? Math.max(rx, ry) : Math.min(rx, ry);
}

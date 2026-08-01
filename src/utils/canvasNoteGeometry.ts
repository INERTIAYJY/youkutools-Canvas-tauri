import type {
  CanvasNoteLineType,
  CanvasNotePoint,
  CanvasNoteStrokeStyle,
} from '../types/canvasNote';

export interface CanvasNoteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_NOTE_SIZE = 2;

export function getCanvasNoteBounds(
  start: CanvasNotePoint,
  end: CanvasNotePoint,
  minSize = MIN_NOTE_SIZE,
): CanvasNoteBounds {
  const width = Math.max(Math.abs(end.x - start.x), minSize);
  const height = Math.max(Math.abs(end.y - start.y), minSize);
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width,
    height,
  };
}

export function getCanvasNotePointBounds(
  points: readonly CanvasNotePoint[],
  padding = 0,
): CanvasNoteBounds {
  if (points.length === 0) return { x: 0, y: 0, width: MIN_NOTE_SIZE, height: MIN_NOTE_SIZE };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, MIN_NOTE_SIZE),
    height: Math.max(maxY - minY + padding * 2, MIN_NOTE_SIZE),
  };
}

export function localizeCanvasNotePoints(
  points: readonly CanvasNotePoint[],
  bounds: CanvasNoteBounds,
): CanvasNotePoint[] {
  return points.map((point) => ({
    ...point,
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  }));
}

export function scaleCanvasNotePoints(
  points: readonly CanvasNotePoint[],
  from: Pick<CanvasNoteBounds, 'width' | 'height'>,
  to: Pick<CanvasNoteBounds, 'width' | 'height'>,
): CanvasNotePoint[] {
  const scaleX = to.width / Math.max(from.width, MIN_NOTE_SIZE);
  const scaleY = to.height / Math.max(from.height, MIN_NOTE_SIZE);
  return points.map((point) => ({ ...point, x: point.x * scaleX, y: point.y * scaleY }));
}

export function createSmoothCanvasNotePath(points: readonly CanvasNotePoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    commands.push(`Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(' ');
}

/** 未手动调节曲率时的默认控制点：沿法线方向轻微外凸。 */
export function getDefaultCurveControl(
  start: CanvasNotePoint,
  end: CanvasNotePoint,
): CanvasNotePoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(36, length * 0.18);
  return {
    x: (start.x + end.x) / 2 - (dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  };
}

/** 线条是否已存在用户自定义的曲率控制点（存放在首尾点之间）。 */
export function hasCanvasNoteCurveControl(points: readonly CanvasNotePoint[]): boolean {
  return points.length >= 3;
}

/** 取二次贝塞尔的控制点：优先使用用户拖出的控制点，否则回退到默认弧度。 */
export function getCanvasNoteCurveControl(points: readonly CanvasNotePoint[]): CanvasNotePoint {
  const start = points[0];
  const end = points[points.length - 1];
  if (hasCanvasNoteCurveControl(points)) return points[1];
  return getDefaultCurveControl(start, end);
}

/** 曲线中点（t = 0.5），手柄就画在这里，拖动时曲线会跟着手指走。 */
export function getCanvasNoteCurveHandle(points: readonly CanvasNotePoint[]): CanvasNotePoint {
  const start = points[0];
  const end = points[points.length - 1];
  const control = getCanvasNoteCurveControl(points);
  return {
    x: (start.x + 2 * control.x + end.x) / 4,
    y: (start.y + 2 * control.y + end.y) / 4,
  };
}

/** 把手柄拖到 handle 处：反推控制点，使曲线中点恰好落在 handle。 */
export function setCanvasNoteCurveHandle(
  points: readonly CanvasNotePoint[],
  handle: CanvasNotePoint,
): CanvasNotePoint[] {
  const start = points[0];
  const end = points[points.length - 1];
  const control = {
    x: 2 * handle.x - (start.x + end.x) / 2,
    y: 2 * handle.y - (start.y + end.y) / 2,
  };
  return [{ ...start }, control, { ...end }];
}

/** 清除自定义曲率，回到默认弧度。 */
export function clearCanvasNoteCurveControl(
  points: readonly CanvasNotePoint[],
): CanvasNotePoint[] {
  return [{ ...points[0] }, { ...points[points.length - 1] }];
}

export function createLinearCanvasNotePath(
  points: readonly CanvasNotePoint[],
  lineType: CanvasNoteLineType,
): string {
  if (points.length < 2) return '';
  const start = points[0];
  const end = points[points.length - 1];
  if (lineType === 'elbow') {
    const middleX = start.x + (end.x - start.x) / 2;
    return `M ${start.x} ${start.y} L ${middleX} ${start.y} L ${middleX} ${end.y} L ${end.x} ${end.y}`;
  }
  if (lineType === 'curved') {
    const control = getCanvasNoteCurveControl(points);
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * 箭头方向锚点：箭翼要贴着线条真实的切线方向，
 * 因此曲线取控制点、折线取拐点、直线取对端。
 */
export function getCanvasNoteArrowAnchors(
  points: readonly CanvasNotePoint[],
  lineType: CanvasNoteLineType,
): { start: CanvasNotePoint; startFrom: CanvasNotePoint; end: CanvasNotePoint; endFrom: CanvasNotePoint } {
  const start = points[0];
  const end = points[points.length - 1];
  const samePoint = (a: CanvasNotePoint, b: CanvasNotePoint) => a.x === b.x && a.y === b.y;
  let startFrom = end;
  let endFrom = start;
  if (lineType === 'curved') {
    const control = getCanvasNoteCurveControl(points);
    startFrom = control;
    endFrom = control;
  } else if (lineType === 'elbow') {
    const middleX = start.x + (end.x - start.x) / 2;
    startFrom = { x: middleX, y: start.y };
    endFrom = { x: middleX, y: end.y };
  }
  if (samePoint(startFrom, start)) startFrom = end;
  if (samePoint(endFrom, end)) endFrom = start;
  return { start, startFrom, end, endFrom };
}

export function createArrowheadPath(
  from: CanvasNotePoint,
  tip: CanvasNotePoint,
  size: number,
): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = Math.PI / 7;
  const left = {
    x: tip.x - Math.cos(angle - wing) * size,
    y: tip.y - Math.sin(angle - wing) * size,
  };
  const right = {
    x: tip.x - Math.cos(angle + wing) * size,
    y: tip.y - Math.sin(angle + wing) * size,
  };
  return `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`;
}

export function getCanvasNoteDashArray(
  strokeStyle: CanvasNoteStrokeStyle,
  strokeWidth: number,
): string | undefined {
  if (strokeStyle === 'dashed') return `${strokeWidth * 5} ${strokeWidth * 4}`;
  if (strokeStyle === 'dotted') return `${strokeWidth} ${strokeWidth * 3}`;
  return undefined;
}

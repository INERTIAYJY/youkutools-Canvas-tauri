/**
 * 缓存最近一次画布指针坐标，为 Agent 和快捷创建操作提供稳定的节点落点。
 */
export interface CanvasPointerPosition {
  x: number;
  y: number;
}

const DEFAULT_CANVAS_POINTER_POSITION: Readonly<CanvasPointerPosition> = {
  x: 300,
  y: 200,
};

let lastCanvasPointerPosition: CanvasPointerPosition | null = null;

export function setCanvasPointerPosition(position: CanvasPointerPosition): void {
  lastCanvasPointerPosition = { x: position.x, y: position.y };
}

export function getLastCanvasPointerPosition(): CanvasPointerPosition | null {
  return lastCanvasPointerPosition ? { ...lastCanvasPointerPosition } : null;
}

export function getCanvasPointerPosition(): CanvasPointerPosition {
  return getLastCanvasPointerPosition() ?? { ...DEFAULT_CANVAS_POINTER_POSITION };
}

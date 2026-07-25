/**
 * 定义画布平移动画事件协议，让浮层和编辑器通过统一事件请求视口位移。
 */
export const CANVAS_PAN_BY_EVENT = 'canvas-pan-by';
export const CANVAS_PAN_DURATION_MS = 280;

export interface CanvasPanProgress {
  deltaX: number;
  deltaY: number;
}

export interface CanvasPanByDetail {
  deltaX: number;
  deltaY: number;
  duration?: number;
  onProgress?: (progress: CanvasPanProgress) => void;
  onComplete?: (progress: CanvasPanProgress) => void;
}

export function requestCanvasPanBy(detail: CanvasPanByDetail) {
  window.dispatchEvent(new CustomEvent<CanvasPanByDetail>(CANVAS_PAN_BY_EVENT, { detail }));
}

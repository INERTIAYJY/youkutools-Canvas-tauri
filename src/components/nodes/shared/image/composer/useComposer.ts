/**
 * useComposer — 图片合成编辑器的图层、画布、工具与撤销栈
 *
 * 图层数组顺序即 z 轴（末尾 = 最上层）。所有「带尺寸」的图层以中心为原点
 * （x/y 为中心点），便于 Transformer 绕中心旋转/缩放。
 *
 * 状态模型：layers / canvas / selectedId 均以 ref 为唯一事实来源，setState 只
 * 接收「已算好的值」而不是更新器函数。这样既能在同一 tick 内连续读写（历史快照
 * 需要读最新值），也避免 StrictMode 双调用把更新器执行两次导致重复添加图层。
 *
 * 撤销栈：所有会改变画面的操作先调用 pushHistory() 存快照。连续操作（拖滑块、
 * 方向键微调）传相同的 tag，短时间内的重复快照会被合并成一条。
 */
import { useCallback, useRef, useState } from 'react';
import { generateId } from '../../../../../store/useAppStore';
import { loadSafeImage } from '../imageUtils';
import { DEFAULT_ADJUSTMENTS } from '../../../../../types/composerTypes';
import type {
  BrushSettings,
  CanvasSettings,
  ComposerTool,
  ImageAdjustments,
  Layer,
  LayerType,
} from '../../../../../types/composerTypes';

const newId = () => `layer-${generateId()}`;

/** 撤销栈上限（一条快照只是图层对象的浅拷贝数组，代价很低） */
const HISTORY_LIMIT = 80;
/** 同 tag 的连续操作在此毫秒内合并为一条历史 */
const HISTORY_MERGE_MS = 600;

const DEFAULT_CANVAS: CanvasSettings = { width: 1024, height: 1024, bg: 'transparent' };

const baseProps = (id: string, name: string, x: number, y: number) => ({
  id,
  name,
  x,
  y,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  visible: true,
  locked: false,
  blendMode: 'source-over' as const,
});

interface Snapshot {
  layers: Layer[];
  canvas: CanvasSettings;
  selectedId: string | null;
}

export type ComposerApi = ReturnType<typeof useComposer>;

export function useComposer() {
  const [layers, setLayersState] = useState<Layer[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [canvas, setCanvasState] = useState<CanvasSettings>(DEFAULT_CANVAS);
  const [tool, setToolState] = useState<ComposerTool>('select');
  const [brush, setBrushState] = useState<BrushSettings>({ color: '#ffffff', size: 12 });
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 });

  const layersRef = useRef<Layer[]>([]);
  const canvasRef = useRef<CanvasSettings>(DEFAULT_CANVAS);
  const selectedIdRef = useRef<string | null>(null);

  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const lastTagRef = useRef<{ tag: string; at: number } | null>(null);

  /* ── 基础写入（ref 与 state 同步） ── */
  const commitLayers = useCallback((next: Layer[]) => {
    layersRef.current = next;
    setLayersState(next);
  }, []);

  const setSelectedId = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedIdState(id);
  }, []);

  const commitCanvas = useCallback((next: CanvasSettings) => {
    canvasRef.current = next;
    setCanvasState(next);
  }, []);

  /* ── 撤销栈 ── */
  const syncHistoryDepth = useCallback(() => {
    setHistoryDepth({ past: pastRef.current.length, future: futureRef.current.length });
  }, []);

  const snapshot = useCallback((): Snapshot => ({
    layers: layersRef.current,
    canvas: canvasRef.current,
    selectedId: selectedIdRef.current,
  }), []);

  /**
   * 记录一条历史。tag 相同且间隔很短的连续操作会合并，
   * 避免拖一次滑块就压进几十条快照。
   */
  const pushHistory = useCallback((tag?: string) => {
    const now = Date.now();
    if (tag && lastTagRef.current?.tag === tag && now - lastTagRef.current.at < HISTORY_MERGE_MS) {
      lastTagRef.current.at = now;
      return;
    }
    lastTagRef.current = tag ? { tag, at: now } : null;
    pastRef.current = [...pastRef.current, snapshot()].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    syncHistoryDepth();
  }, [snapshot, syncHistoryDepth]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    commitLayers(snap.layers);
    commitCanvas(snap.canvas);
    setSelectedId(snap.layers.some((l) => l.id === snap.selectedId) ? snap.selectedId : null);
  }, [commitCanvas, commitLayers, setSelectedId]);

  const undo = useCallback(() => {
    const snap = pastRef.current.pop();
    if (!snap) return;
    futureRef.current = [...futureRef.current, snapshot()].slice(-HISTORY_LIMIT);
    lastTagRef.current = null;
    applySnapshot(snap);
    syncHistoryDepth();
  }, [applySnapshot, snapshot, syncHistoryDepth]);

  const redo = useCallback(() => {
    const snap = futureRef.current.pop();
    if (!snap) return;
    pastRef.current = [...pastRef.current, snapshot()].slice(-HISTORY_LIMIT);
    lastTagRef.current = null;
    applySnapshot(snap);
    syncHistoryDepth();
  }, [applySnapshot, snapshot, syncHistoryDepth]);

  const clearHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastTagRef.current = null;
    syncHistoryDepth();
  }, [syncHistoryDepth]);

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

  /* ── 图层增删改 ── */

  /** 修改图层。tag 用于合并连续修改（如滑块），传 null 表示不记历史 */
  const updateLayer = useCallback((id: string, patch: Partial<Layer>, tag?: string | null) => {
    if (tag !== null) pushHistory(tag);
    commitLayers(layersRef.current.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
  }, [commitLayers, pushHistory]);

  const removeLayer = useCallback((id: string) => {
    pushHistory();
    commitLayers(layersRef.current.filter((l) => l.id !== id));
    if (selectedIdRef.current === id) setSelectedId(null);
  }, [commitLayers, pushHistory, setSelectedId]);

  const duplicateLayer = useCallback((id: string) => {
    const idx = layersRef.current.findIndex((l) => l.id === id);
    if (idx < 0) return;
    pushHistory();
    const copyId = newId();
    const src = layersRef.current[idx];
    const copy = { ...src, id: copyId, name: `${src.name} 副本`, x: src.x + 24, y: src.y + 24 } as Layer;
    const next = layersRef.current.slice();
    next.splice(idx + 1, 0, copy);
    commitLayers(next);
    setSelectedId(copyId);
  }, [commitLayers, pushHistory, setSelectedId]);

  /** dir: 'up'|'down' 相邻交换；'top'|'bottom' 置顶/置底 */
  const reorderLayer = useCallback((id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
    const idx = layersRef.current.findIndex((l) => l.id === id);
    if (idx < 0) return;
    pushHistory();
    const next = layersRef.current.slice();
    const [item] = next.splice(idx, 1);
    if (dir === 'top') next.push(item);
    else if (dir === 'bottom') next.unshift(item);
    else if (dir === 'up') next.splice(Math.min(idx + 1, next.length), 0, item);
    else next.splice(Math.max(idx - 1, 0), 0, item);
    commitLayers(next);
  }, [commitLayers, pushHistory]);

  /** 拖动图层列表重排：把 from 位置的图层插到 to 位置（均为 layers 数组下标） */
  const moveLayerToIndex = useCallback((from: number, to: number) => {
    const list = layersRef.current;
    if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    pushHistory();
    const next = list.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commitLayers(next);
  }, [commitLayers, pushHistory]);

  const addLayer = useCallback((layer: Layer) => {
    pushHistory();
    commitLayers([...layersRef.current, layer]);
    setSelectedId(layer.id);
  }, [commitLayers, pushHistory, setSelectedId]);

  /** 居中放入一张图片图层（若超出画布按比例缩小适配） */
  const addImageLayer = useCallback(async (src: string, label = '图片') => {
    const img = await loadSafeImage(src);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const cv = canvasRef.current;
    const fit = Math.min(1, (cv.width * 0.9) / w, (cv.height * 0.9) / h);
    const id = newId();
    addLayer({
      ...baseProps(id, label, cv.width / 2, cv.height / 2),
      type: 'image',
      src: img.src,
      image: img,
      width: w,
      height: h,
      scaleX: fit,
      scaleY: fit,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
    });
  }, [addLayer]);

  const addText = useCallback((text = '双击编辑文字', label = '文字') => {
    const cv = canvasRef.current;
    const id = newId();
    addLayer({
      ...baseProps(id, label, cv.width / 2, cv.height / 2),
      type: 'text',
      text,
      fontSize: Math.round(cv.height / 14),
      fontFamily: 'sans-serif',
      fontStyle: 'bold',
      fill: '#ffffff',
      align: 'center',
      width: Math.round(cv.width * 0.6),
      lineHeight: 1.2,
      letterSpacing: 0,
      stroke: '#000000',
      strokeWidth: 0,
      shadow: false,
    });
  }, [addLayer]);

  const addShape = useCallback((type: Extract<LayerType, 'rect' | 'ellipse' | 'line' | 'arrow'>) => {
    const cv = canvasRef.current;
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const s = Math.min(cv.width, cv.height) * 0.3;
    const id = newId();
    if (type === 'rect' || type === 'ellipse') {
      addLayer({
        ...baseProps(id, type === 'rect' ? '矩形' : '椭圆', cx, cy),
        type,
        width: s,
        height: s * 0.7,
        fill: '#6366f1',
        stroke: '#ffffff',
        strokeWidth: 0,
        cornerRadius: 0,
      });
    } else {
      addLayer({
        ...baseProps(id, type === 'line' ? '直线' : '箭头', cx - s / 2, cy),
        type,
        points: [0, 0, s, 0],
        stroke: '#ffffff',
        strokeWidth: Math.max(2, Math.round(s / 30)),
      });
    }
  }, [addLayer]);

  /** 收笔时落一条画笔/橡皮图层（points 为画布绝对坐标，图层原点取 0,0） */
  const addBrushStroke = useCallback((points: number[], erase: boolean) => {
    if (points.length < 4) return;
    const id = newId();
    addLayer({
      ...baseProps(id, erase ? '橡皮' : '画笔', 0, 0),
      type: 'brush',
      points,
      stroke: brush.color,
      strokeWidth: brush.size,
      erase,
    });
  }, [addLayer, brush.color, brush.size]);

  /* ── 画布 ── */
  const updateCanvas = useCallback((patch: Partial<CanvasSettings>, tag?: string | null) => {
    if (tag !== null) pushHistory(tag);
    commitCanvas({ ...canvasRef.current, ...patch });
  }, [commitCanvas, pushHistory]);

  /* ── 便捷操作 ── */
  const flipLayer = useCallback((id: string, axis: 'x' | 'y') => {
    const layer = layersRef.current.find((l) => l.id === id);
    if (!layer) return;
    updateLayer(id, axis === 'x' ? { scaleX: -layer.scaleX } : { scaleY: -layer.scaleY });
  }, [updateLayer]);

  const resetTransform = useCallback((id: string) => {
    updateLayer(id, { rotation: 0, scaleX: 1, scaleY: 1 });
  }, [updateLayer]);

  const setAdjustments = useCallback((id: string, patch: Partial<ImageAdjustments>, tag?: string | null) => {
    const layer = layersRef.current.find((l) => l.id === id);
    if (!layer || layer.type !== 'image') return;
    updateLayer(id, { adjustments: { ...layer.adjustments, ...patch } } as Partial<Layer>, tag);
  }, [updateLayer]);

  const resetAdjustments = useCallback((id: string) => {
    updateLayer(id, { adjustments: { ...DEFAULT_ADJUSTMENTS } } as Partial<Layer>);
  }, [updateLayer]);

  const setTool = useCallback((next: ComposerTool) => {
    setToolState(next);
    if (next !== 'select') setSelectedId(null);
  }, [setSelectedId]);

  const setBrush = useCallback((patch: Partial<BrushSettings>) => {
    setBrushState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    commitLayers([]);
    setSelectedId(null);
    commitCanvas(DEFAULT_CANVAS);
    setToolState('select');
    clearHistory();
  }, [clearHistory, commitCanvas, commitLayers, setSelectedId]);

  return {
    layers,
    layersRef,
    selectedId,
    setSelectedId,
    selectedLayer,
    canvas,
    canvasRef,
    updateCanvas,
    tool,
    setTool,
    brush,
    setBrush,
    updateLayer,
    removeLayer,
    duplicateLayer,
    reorderLayer,
    moveLayerToIndex,
    addImageLayer,
    addText,
    addShape,
    addBrushStroke,
    flipLayer,
    resetTransform,
    setAdjustments,
    resetAdjustments,
    pushHistory,
    undo,
    redo,
    canUndo: historyDepth.past > 0,
    canRedo: historyDepth.future > 0,
    clearHistory,
    reset,
  };
}

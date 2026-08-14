/**
 * useCanvasDrawing — 画布绘图交互 hook。
 * 把指针拖拽转换为画布笔记（CanvasNote）的绘制草稿，处理选择、矩形/菱形/椭圆/箭头/直线/自由绘制、
 * 橡皮擦与图片/文本插入，几何计算委托 canvasNoteGeometry，落盘走 fileService 上传源文件。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useReactFlow, type Node as RFNode } from '@xyflow/react';
import { useAppStore, generateId } from '../store/useAppStore';
import { uploadSourceFileToProject } from '../services/fileService';
import {
  createCanvasNoteData,
  DEFAULT_CANVAS_NOTE_STYLE,
  isCanvasNoteKind,
  type BaseNodeData,
  type CanvasDrawingTool,
  type CanvasNoteData,
  type CanvasNoteKind,
  type CanvasNotePatch,
  type CanvasNotePoint,
  type CanvasNoteStyle,
} from '../types';
import {
  getCanvasNoteBounds,
  getCanvasNotePointBounds,
  localizeCanvasNotePoints,
} from '../utils/canvasNoteGeometry';

interface DrawingDraft {
  kind: Exclude<CanvasNoteKind, 'text' | 'image'>;
  start: CanvasNotePoint;
  current: CanvasNotePoint;
  points: CanvasNotePoint[];
  style: CanvasNoteStyle;
}

interface PendingNoteImage {
  imageUrl: string;
  fileName: string;
  filePath?: string;
  width: number;
  height: number;
}

const DRAWING_KINDS = new Set<CanvasDrawingTool>([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freehand',
]);

const NOTE_LABELS: Record<CanvasNoteKind, string> = {
  rectangle: '矩形笔记',
  diamond: '菱形笔记',
  ellipse: '椭圆笔记',
  arrow: '箭头笔记',
  line: '直线笔记',
  freehand: '手绘笔记',
  text: '文本笔记',
  image: '图片笔记',
};

function cloneDefaultStyles(): Record<CanvasNoteKind, CanvasNoteStyle> {
  const kinds = [...DRAWING_KINDS, 'text', 'image'] as CanvasNoteKind[];
  return Object.fromEntries(kinds.map((kind) => [
    kind,
    {
      ...DEFAULT_CANVAS_NOTE_STYLE,
      endArrowhead: kind === 'arrow' ? 'arrow' : 'none',
    },
  ])) as Record<CanvasNoteKind, CanvasNoteStyle>;
}

function getImagePlacementSize(imageUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : 16 / 9;
      const width = Math.min(480, Math.max(180, image.naturalWidth || 320));
      resolve({ width, height: Math.max(80, width / ratio) });
    };
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = imageUrl;
  });
}

function createNoteNode(
  kind: CanvasNoteKind,
  position: CanvasNotePoint,
  note: CanvasNoteData,
  media?: Pick<PendingNoteImage, 'imageUrl' | 'fileName' | 'filePath'>,
): RFNode<BaseNodeData> {
  return {
    id: `node-${generateId()}`,
    type: 'canvas-note',
    position,
    data: {
      label: media?.fileName || NOTE_LABELS[kind],
      type: 'canvas-note',
      note,
      nodeWidth: note.width,
      nodeHeight: note.height,
      ...(media ? {
        imageUrl: media.imageUrl,
        fileName: media.fileName,
        filePath: media.filePath,
      } : {}),
    },
    draggable: true,
    selectable: true,
  };
}

function materializeDraft(draft: DrawingDraft): RFNode<BaseNodeData> {
  if (draft.kind === 'freehand') {
    const padding = Math.max(4, draft.style.strokeWidth * 3);
    const bounds = getCanvasNotePointBounds(draft.points, padding);
    return createNoteNode(draft.kind, { x: bounds.x, y: bounds.y }, createCanvasNoteData(draft.kind, {
      width: bounds.width,
      height: bounds.height,
      points: localizeCanvasNotePoints(draft.points, bounds),
      style: draft.style,
    }));
  }

  const draggedWidth = Math.abs(draft.current.x - draft.start.x);
  const draggedHeight = Math.abs(draft.current.y - draft.start.y);
  const clicked = draggedWidth < 4 && draggedHeight < 4;
  const end = clicked
    ? { x: draft.start.x + 160, y: draft.start.y + 100 }
    : draft.current;
  const bounds = getCanvasNoteBounds(draft.start, end, 8);
  const points = (draft.kind === 'arrow' || draft.kind === 'line')
    ? localizeCanvasNotePoints([draft.start, end], bounds)
    : undefined;
  return createNoteNode(draft.kind, { x: bounds.x, y: bounds.y }, createCanvasNoteData(draft.kind, {
    width: bounds.width,
    height: bounds.height,
    ...(points ? { points } : {}),
    style: draft.style,
  }));
}

function isDrawingUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.canvas-drawing-ui'));
}

export function useCanvasDrawing() {
  const reactFlow = useReactFlow();
  const nodes = useAppStore((state) => state.nodes);
  const selectedNodeIds = useAppStore((state) => state.selectedNodeIds);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const addNode = useAppStore((state) => state.addNode);
  const deleteNode = useAppStore((state) => state.deleteNode);
  const duplicateCanvasNote = useAppStore((state) => state.duplicateCanvasNote);
  const updateCanvasNote = useAppStore((state) => state.updateCanvasNote);
  const updateCanvasNoteTransient = useAppStore((state) => state.updateCanvasNoteTransient);
  const moveCanvasNoteLayer = useAppStore((state) => state.moveCanvasNoteLayer);
  const commitToHistory = useAppStore((state) => state.commitToHistory);
  const showToast = useAppStore((state) => state.showToast);
  const [activeTool, setActiveTool] = useState<CanvasDrawingTool>('select');
  const [toolStyles, setToolStyles] = useState(cloneDefaultStyles);
  const [draft, setDraft] = useState<DrawingDraft | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingNoteImage | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const erasedIdsRef = useRef(new Set<string>());
  const imageRequestRef = useRef(0);

  const selectedNoteNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) return null;
    return nodes.find((node) => node.id === selectedNodeIds[0] && node.type === 'canvas-note' && node.data.note) ?? null;
  }, [nodes, selectedNodeIds]);

  const panelNote = activeTool !== 'select' && isCanvasNoteKind(activeTool)
    ? createCanvasNoteData(activeTool, { style: toolStyles[activeTool] })
    : selectedNoteNode?.data.note ?? null;

  const selectCreatedNode = useCallback((node: RFNode<BaseNodeData>) => {
    addNode(node);
    const store = useAppStore.getState();
    store.onNodesChange([
      ...store.nodes.filter((item) => item.selected).map((item) => ({ type: 'select' as const, id: item.id, selected: false })),
      { type: 'select' as const, id: node.id, selected: true },
    ]);
    store.setSelectedNodeIds([node.id]);
  }, [addNode]);

  const chooseImage = useCallback(async () => {
    const requestId = ++imageRequestRef.current;
    const result = await uploadSourceFileToProject('.png,.jpg,.jpeg,.webp,.gif,.bmp', currentProjectId);
    if (requestId !== imageRequestRef.current) return;
    if (!result?.dataUrl) {
      setPendingImage(null);
      setActiveTool('select');
      return;
    }
    const size = await getImagePlacementSize(result.dataUrl);
    if (requestId !== imageRequestRef.current) return;
    setPendingImage({
      imageUrl: result.dataUrl,
      fileName: result.fileName,
      filePath: result.filePath,
      ...size,
    });
  }, [currentProjectId]);

  const chooseTool = useCallback((tool: CanvasDrawingTool) => {
    setDraft(null);
    setActiveTool(tool);
    if (tool !== 'select') {
      const store = useAppStore.getState();
      const selectedChanges = store.nodes
        .filter((node) => node.selected)
        .map((node) => ({ type: 'select' as const, id: node.id, selected: false }));
      if (selectedChanges.length > 0) store.onNodesChange(selectedChanges);
      store.setSelectedNodeIds([]);
    }
    if (tool === 'image') {
      setPendingImage(null);
      void chooseImage().catch((error) => {
        console.error('[画布笔记] 选择图片失败:', error);
        showToast('选择图片失败', 'error');
        setActiveTool('select');
      });
    } else {
      imageRequestRef.current += 1;
      setPendingImage(null);
    }
  }, [chooseImage, showToast]);

  const applyNotePatch = useCallback((patch: CanvasNotePatch, transient = false) => {
    if (selectedNoteNode) {
      return transient
        ? updateCanvasNoteTransient(selectedNoteNode.id, patch)
        : updateCanvasNote(selectedNoteNode.id, patch);
    }
    if (!isCanvasNoteKind(activeTool)) return false;
    if (patch.style) {
      setToolStyles((current) => ({
        ...current,
        [activeTool]: { ...current[activeTool], ...patch.style },
      }));
      return true;
    }
    return false;
  }, [activeTool, selectedNoteNode, updateCanvasNote, updateCanvasNoteTransient]);

  const eraseAt = useCallback((clientX: number, clientY: number) => {
    const hit = document.elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>('[data-canvas-note-id]'))
      .find(Boolean);
    const nodeId = hit?.dataset.canvasNoteId;
    if (!nodeId || erasedIdsRef.current.has(nodeId)) return;
    erasedIdsRef.current.add(nodeId);
    deleteNode(nodeId);
  }, [deleteNode]);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTool === 'select' || event.button !== 0 || isDrawingUiTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

    if (activeTool === 'eraser') {
      erasedIdsRef.current.clear();
      eraseAt(event.clientX, event.clientY);
      return;
    }
    if (activeTool === 'image') {
      if (!pendingImage) return;
      const note = createCanvasNoteData('image', {
        width: pendingImage.width,
        height: pendingImage.height,
        style: toolStyles.image,
      });
      selectCreatedNode(createNoteNode('image', point, note, pendingImage));
      setPendingImage(null);
      setActiveTool('select');
      return;
    }
    if (activeTool === 'text') {
      const note = createCanvasNoteData('text', { style: toolStyles.text });
      const node = createNoteNode('text', point, note);
      selectCreatedNode(node);
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('canvas-note-edit-text', { detail: { nodeId: node.id } }));
      });
      setActiveTool('select');
      return;
    }
    if (!DRAWING_KINDS.has(activeTool)) return;
    setDraft({
      kind: activeTool as DrawingDraft['kind'],
      start: point,
      current: point,
      points: [point],
      style: { ...toolStyles[activeTool] },
    });
  }, [activeTool, eraseAt, pendingImage, reactFlow, selectCreatedNode, toolStyles]);

  const handlePointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId || activeTool === 'select') return;
    if (activeTool === 'eraser') {
      event.preventDefault();
      event.stopPropagation();
      eraseAt(event.clientX, event.clientY);
      return;
    }
    if (!draft) return;
    event.preventDefault();
    event.stopPropagation();
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setDraft((current) => {
      if (!current) return current;
      if (current.kind !== 'freehand') return { ...current, current: point };
      const previous = current.points[current.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return current;
      return { ...current, current: point, points: [...current.points, point] };
    });
  }, [activeTool, draft, eraseAt, reactFlow]);

  const handlePointerUpCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    erasedIdsRef.current.clear();
    if (!draft) return;
    event.preventDefault();
    event.stopPropagation();
    selectCreatedNode(materializeDraft(draft));
    setDraft(null);
    setActiveTool('select');
  }, [draft, selectCreatedNode]);

  const draftNode = useMemo(() => {
    if (!draft) return null;
    const node = materializeDraft(draft);
    return {
      ...node,
      id: 'canvas-note-draft',
      draggable: false,
      selectable: false,
      data: { ...node.data, displayId: undefined },
    } as RFNode<BaseNodeData>;
  }, [draft]);

  return {
    activeTool,
    chooseTool,
    selectedNoteNode,
    panelNote,
    pendingImage,
    draftNode,
    applyNotePatch,
    beginNoteChange: () => { if (selectedNoteNode) commitToHistory(); },
    endNoteChange: () => { if (selectedNoteNode) commitToHistory(); },
    duplicateSelectedNote: () => selectedNoteNode && duplicateCanvasNote(selectedNoteNode.id),
    deleteSelectedNote: () => selectedNoteNode && deleteNode(selectedNoteNode.id),
    moveSelectedNoteLayer: (direction: Parameters<typeof moveCanvasNoteLayer>[1]) => (
      selectedNoteNode ? moveCanvasNoteLayer(selectedNoteNode.id, direction) : false
    ),
    requestCrop: () => {
      if (selectedNoteNode) {
        window.dispatchEvent(new CustomEvent('canvas-note-crop', { detail: { nodeId: selectedNoteNode.id } }));
      }
    },
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
  };
}

/**
 * types/canvasNote — 画布笔记（CanvasNote）的领域类型。
 * 定义笔记形状种类（矩形/菱形/椭圆/箭头/直线/自由绘制/文本/图片）、绘图工具、
 * 描边与粗糙度样式、圆角、字体、层级等类型，以及笔记的点位、补丁与数据模型。
 */
export type CanvasNoteKind =
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freehand'
  | 'text'
  | 'image';

export type CanvasDrawingTool = 'select' | CanvasNoteKind | 'eraser';
export type CanvasNoteStrokeWidth = 1 | 2 | 4;
export type CanvasNoteStrokeStyle = 'solid' | 'dashed' | 'dotted';
export type CanvasNoteRoughness = 'architect' | 'artist' | 'cartoonist';
export type CanvasNoteRoundness = 'sharp' | 'round';
export type CanvasNoteLineType = 'straight' | 'curved' | 'elbow';
export type CanvasNoteArrowhead = 'none' | 'arrow';
export type CanvasNoteFontFamily = 'hand' | 'sans' | 'mono' | 'serif';
export type CanvasNoteFontSize = 16 | 20 | 28 | 36;
export type CanvasNoteTextAlign = 'left' | 'center' | 'right';
export type CanvasNoteLayerDirection = 'back' | 'backward' | 'forward' | 'front';

export interface CanvasNotePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface CanvasNoteCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasNoteStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: CanvasNoteStrokeWidth;
  strokeStyle: CanvasNoteStrokeStyle;
  roughness: CanvasNoteRoughness;
  roundness: CanvasNoteRoundness;
  opacity: number;
  lineType: CanvasNoteLineType;
  startArrowhead: CanvasNoteArrowhead;
  endArrowhead: CanvasNoteArrowhead;
  pressure: boolean;
  fontFamily: CanvasNoteFontFamily;
  fontSize: CanvasNoteFontSize;
  textAlign: CanvasNoteTextAlign;
}

export interface CanvasNoteData {
  kind: CanvasNoteKind;
  style: CanvasNoteStyle;
  width: number;
  height: number;
  points?: CanvasNotePoint[];
  text?: string;
  link?: string;
  crop?: CanvasNoteCrop;
}

export type CanvasNotePatch = Omit<Partial<CanvasNoteData>, 'style'> & {
  style?: Partial<CanvasNoteStyle>;
};

export const DEFAULT_CANVAS_NOTE_STYLE: Readonly<CanvasNoteStyle> = Object.freeze({
  strokeColor: 'var(--theme-text)',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 'architect',
  roundness: 'round',
  opacity: 100,
  lineType: 'straight',
  startArrowhead: 'none',
  endArrowhead: 'arrow',
  pressure: true,
  fontFamily: 'hand',
  fontSize: 20,
  textAlign: 'left',
});

export function createCanvasNoteData(
  kind: CanvasNoteKind,
  patch: Partial<CanvasNoteData> = {},
): CanvasNoteData {
  const defaultSize = kind === 'text'
    ? { width: 220, height: 56 }
    : kind === 'image'
      ? { width: 320, height: 220 }
      : { width: 160, height: 100 };
  return {
    kind,
    ...defaultSize,
    ...(kind === 'text' ? { text: '' } : {}),
    ...patch,
    style: {
      ...DEFAULT_CANVAS_NOTE_STYLE,
      endArrowhead: kind === 'arrow' ? 'arrow' : 'none',
      ...(patch.style ?? {}),
    },
  };
}

export function isCanvasNoteKind(value: unknown): value is CanvasNoteKind {
  return [
    'rectangle',
    'diamond',
    'ellipse',
    'arrow',
    'line',
    'freehand',
    'text',
    'image',
  ].includes(String(value));
}

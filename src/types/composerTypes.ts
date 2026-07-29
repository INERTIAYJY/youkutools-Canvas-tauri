/**
 * 图片合成编辑器 — 图层数据模型
 *
 * 坐标/旋转/缩放沿用 Konva 约定：x/y 为图层原点（页面坐标系，像素），
 * rotation 为角度（deg），scaleX/scaleY 为缩放倍率（负值表示翻转）。
 */

export type LayerType = 'image' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'brush';

/** 混合模式 — 直接对应 Canvas 的 globalCompositeOperation */
export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'darken', label: '变暗' },
  { value: 'lighten', label: '变亮' },
  { value: 'color-dodge', label: '颜色减淡' },
  { value: 'color-burn', label: '颜色加深' },
  { value: 'soft-light', label: '柔光' },
  { value: 'hard-light', label: '强光' },
  { value: 'difference', label: '差值' },
  { value: 'exclusion', label: '排除' },
  { value: 'hue', label: '色相' },
  { value: 'saturation', label: '饱和度' },
  { value: 'color', label: '颜色' },
  { value: 'luminosity', label: '明度' },
];

/**
 * 图片图层调色参数 — 取值区间对齐 Konva.Filters：
 * brightness → Brighten(-1~1)，contrast → Contrast(-100~100)，
 * saturation/luminance → HSL(-1~1)，hue → HSL(0~359)，blur → Blur(px)。
 */
export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  luminance: number;
  blur: number;
  grayscale: boolean;
  invert: boolean;
  sepia: boolean;
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  luminance: 0,
  blur: 0,
  grayscale: false,
  invert: false,
  sepia: false,
};

/** 是否为「无调整」——用于跳过 Konva 的 cache/filter 开销 */
export const isDefaultAdjustments = (a: ImageAdjustments | undefined): boolean =>
  !a
  || (a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && a.hue === 0
    && a.luminance === 0 && a.blur === 0 && !a.grayscale && !a.invert && !a.sepia);

export interface BaseLayer {
  id: string;
  type: LayerType;
  name: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  /** 锁定后不可拖拽 / 变换 / 选中 */
  locked: boolean;
  blendMode: BlendMode;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string; // 安全 data: URL（已规避跨源污染）
  image: HTMLImageElement;
  width: number; // 自然像素尺寸
  height: number;
  adjustments: ImageAdjustments;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: string; // 'normal' | 'bold' | 'italic' | 'italic bold'
  fill: string;
  align: 'left' | 'center' | 'right';
  width: number; // 文本框宽（自动换行）
  lineHeight: number;
  letterSpacing: number;
  stroke: string;
  strokeWidth: number;
  shadow: boolean;
}

export interface ShapeLayer extends BaseLayer {
  type: 'rect' | 'ellipse';
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface LineLayer extends BaseLayer {
  type: 'line' | 'arrow';
  points: number[]; // 相对图层原点的折线点
  stroke: string;
  strokeWidth: number;
}

/** 自由画笔 / 橡皮（erase 走 destination-out，抹掉其下方已绘制内容） */
export interface BrushLayer extends BaseLayer {
  type: 'brush';
  points: number[];
  stroke: string;
  strokeWidth: number;
  erase: boolean;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | LineLayer | BrushLayer;

/** 带显式宽高的图层（可做数值变换 / 尺寸展示） */
export type SizedLayer = ImageLayer | TextLayer | ShapeLayer;

export type CanvasBg = 'transparent' | string; // 'transparent' 或 CSS 颜色

export interface CanvasSettings {
  width: number;
  height: number;
  bg: CanvasBg;
}

/** 当前激活的画布工具 */
export type ComposerTool = 'select' | 'brush' | 'eraser';

export interface BrushSettings {
  color: string;
  size: number;
}

/** 对齐方向（相对画布） */
export type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

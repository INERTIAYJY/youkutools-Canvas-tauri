/**
 * canvas/CanvasDrawingToolbar — 画布绘图工具栏。
 * 提供选择、矩形、菱形、椭圆、箭头、直线、自由绘制、文本、图片与橡皮擦等绘图工具切换，
 * 仅在画布绘图模式（有可绘制的笔记目标）下显示，选中态直接驱动 useCanvasDrawing 的当前工具。
 */
import { memo } from 'react';
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { CanvasDrawingTool } from '../../types';

interface CanvasDrawingToolbarProps {
  activeTool: CanvasDrawingTool;
  imageReady: boolean;
  onSelectTool: (tool: CanvasDrawingTool) => void;
}

const TOOLS: Array<{ id: CanvasDrawingTool; label: string; icon: LucideIcon }> = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'rectangle', label: '矩形', icon: Square },
  { id: 'diamond', label: '菱形', icon: Diamond },
  { id: 'ellipse', label: '椭圆', icon: Circle },
  { id: 'arrow', label: '箭头', icon: ArrowRight },
  { id: 'line', label: '直线', icon: Minus },
  { id: 'freehand', label: '自由绘制', icon: Pencil },
  { id: 'text', label: '文本笔记', icon: Type },
  { id: 'image', label: '图片笔记', icon: ImageIcon },
  { id: 'eraser', label: '橡皮擦', icon: Eraser },
];

function CanvasDrawingToolbar({ activeTool, imageReady, onSelectTool }: CanvasDrawingToolbarProps) {
  return (
    <div className="canvas-drawing-toolbar canvas-drawing-ui" role="toolbar" aria-label="画布笔记工具">
      {TOOLS.map(({ id, label, icon: ToolIcon }) => {
        const selected = activeTool === id;
        return (
          <button
            key={id}
            type="button"
            className={`canvas-drawing-tool ${selected ? 'is-active' : ''}`}
            aria-label={label}
            aria-pressed={selected}
            data-tooltip={id === 'image' && selected && !imageReady ? '选择图片' : label}
            onClick={() => onSelectTool(id)}
          >
            <ToolIcon size={18} strokeWidth={1.8} aria-hidden="true" />
            {id === 'image' && selected && !imageReady && <span className="canvas-drawing-tool-loading" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export default memo(CanvasDrawingToolbar);

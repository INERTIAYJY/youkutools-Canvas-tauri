import { memo, useMemo } from 'react';
import type { CanvasNoteData, CanvasNotePoint } from '../../types';
import {
  createArrowheadPath,
  createLinearCanvasNotePath,
  createSmoothCanvasNotePath,
  getCanvasNoteDashArray,
} from '../../utils/canvasNoteGeometry';

interface CanvasNoteShapeProps {
  note: CanvasNoteData;
}

function defaultLinePoints(note: CanvasNoteData): CanvasNotePoint[] {
  const inset = Math.max(2, note.style.strokeWidth * 2);
  return [
    { x: inset, y: inset },
    { x: Math.max(inset, note.width - inset), y: Math.max(inset, note.height - inset) },
  ];
}

function CanvasNoteShape({ note }: CanvasNoteShapeProps) {
  const { kind, style, width, height } = note;
  const points = note.points?.length ? note.points : defaultLinePoints(note);
  const dashArray = getCanvasNoteDashArray(style.strokeStyle, style.strokeWidth);
  const inset = Math.max(1, style.strokeWidth);
  const roughLayers = style.roughness === 'architect' ? 1 : style.roughness === 'artist' ? 2 : 3;
  const linePath = useMemo(
    () => kind === 'freehand'
      ? createSmoothCanvasNotePath(points)
      : createLinearCanvasNotePath(points, style.lineType),
    [kind, points, style.lineType],
  );
  const end = points[points.length - 1];
  const beforeEnd = points[Math.max(0, points.length - 2)];
  const start = points[0];
  const afterStart = points[Math.min(1, points.length - 1)];
  const arrowSize = Math.max(8, style.strokeWidth * 4.5);

  const common = {
    fill: style.backgroundColor,
    stroke: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeDasharray: dashArray,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  const renderShape = (layer: number) => {
    const offset = layer === 0 ? 0 : (layer % 2 === 0 ? -1 : 1) * layer * 0.55;
    const layerProps = {
      ...common,
      fill: layer === 0 ? common.fill : 'none',
      opacity: layer === 0 ? 1 : 0.28,
      transform: offset ? `translate(${offset} ${-offset * 0.65})` : undefined,
    };
    if (kind === 'rectangle') {
      return <rect key={layer} x={inset} y={inset} width={Math.max(1, width - inset * 2)} height={Math.max(1, height - inset * 2)} rx={style.roundness === 'round' ? Math.min(12, width / 8, height / 8) : 1} {...layerProps} />;
    }
    if (kind === 'diamond') {
      return <polygon key={layer} points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`} {...layerProps} />;
    }
    if (kind === 'ellipse') {
      return <ellipse key={layer} cx={width / 2} cy={height / 2} rx={Math.max(1, width / 2 - inset)} ry={Math.max(1, height / 2 - inset)} {...layerProps} />;
    }
    return <path key={layer} d={linePath} {...layerProps} fill="none" strokeWidth={kind === 'freehand' && style.pressure ? style.strokeWidth * 1.45 : style.strokeWidth} />;
  };

  const isLinear = kind === 'arrow' || kind === 'line';
  return (
    <svg
      className="canvas-note-shape"
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {Array.from({ length: roughLayers }, (_, layer) => renderShape(layer))}
      {isLinear && style.startArrowhead === 'arrow' && (
        <path d={createArrowheadPath(afterStart, start, arrowSize)} {...common} fill="none" />
      )}
      {isLinear && style.endArrowhead === 'arrow' && (
        <path d={createArrowheadPath(beforeEnd, end, arrowSize)} {...common} fill="none" />
      )}
    </svg>
  );
}

export default memo(CanvasNoteShape);

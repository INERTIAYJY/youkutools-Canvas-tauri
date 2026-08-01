import { describe, expect, it } from 'vitest';
import {
  clearCanvasNoteCurveControl,
  createArrowheadPath,
  createLinearCanvasNotePath,
  createSmoothCanvasNotePath,
  getCanvasNoteArrowAnchors,
  getCanvasNoteBounds,
  getCanvasNoteCurveControl,
  getCanvasNoteCurveHandle,
  getCanvasNoteDashArray,
  getCanvasNotePointBounds,
  hasCanvasNoteCurveControl,
  localizeCanvasNotePoints,
  scaleCanvasNotePoints,
  setCanvasNoteCurveHandle,
} from '../../src/utils/canvasNoteGeometry';

describe('canvas note geometry', () => {
  it('normalizes reverse drag bounds without losing direction points', () => {
    const bounds = getCanvasNoteBounds({ x: 120, y: 90 }, { x: 20, y: 30 });
    expect(bounds).toEqual({ x: 20, y: 30, width: 100, height: 60 });
    expect(localizeCanvasNotePoints([
      { x: 120, y: 90 },
      { x: 20, y: 30 },
    ], bounds)).toEqual([
      { x: 100, y: 60 },
      { x: 0, y: 0 },
    ]);
  });

  it('computes padded freehand bounds and scales local points', () => {
    const points = [{ x: 10, y: 20 }, { x: 30, y: 50 }, { x: 25, y: 35 }];
    const bounds = getCanvasNotePointBounds(points, 4);
    expect(bounds).toEqual({ x: 6, y: 16, width: 28, height: 38 });
    expect(scaleCanvasNotePoints([{ x: 14, y: 19 }], bounds, { width: 56, height: 76 }))
      .toEqual([{ x: 28, y: 38 }]);
  });

  it('creates stable paths for straight, curved, elbow, and freehand lines', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 40 }];
    expect(createLinearCanvasNotePath(points, 'straight')).toBe('M 0 0 L 100 40');
    expect(createLinearCanvasNotePath(points, 'curved')).toContain(' Q ');
    expect(createLinearCanvasNotePath(points, 'elbow')).toBe('M 0 0 L 50 0 L 50 40 L 100 40');
    expect(createSmoothCanvasNotePath([{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }]))
      .toBe('M 0 0 Q 20 10 30 5 L 40 0');
  });

  it('drags the curve handle so the curve midpoint follows the pointer', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(hasCanvasNoteCurveControl(points)).toBe(false);

    const dragged = setCanvasNoteCurveHandle(points, { x: 50, y: 60 });
    expect(dragged).toHaveLength(3);
    expect(hasCanvasNoteCurveControl(dragged)).toBe(true);
    expect(getCanvasNoteCurveControl(dragged)).toEqual({ x: 50, y: 120 });
    // 手柄落回原处，说明曲线中点确实跟着拖动走
    expect(getCanvasNoteCurveHandle(dragged)).toEqual({ x: 50, y: 60 });
    expect(createLinearCanvasNotePath(dragged, 'curved')).toBe('M 0 0 Q 50 120 100 0');

    // 直线/折线忽略控制点，切换线条类型不会丢失曲率
    expect(createLinearCanvasNotePath(dragged, 'straight')).toBe('M 0 0 L 100 0');
    expect(clearCanvasNoteCurveControl(dragged)).toEqual(points);
  });

  it('anchors arrowheads to the real tangent of each line type', () => {
    const curved = [{ x: 0, y: 0 }, { x: 50, y: 120 }, { x: 100, y: 0 }];
    expect(getCanvasNoteArrowAnchors(curved, 'curved')).toMatchObject({
      startFrom: { x: 50, y: 120 },
      endFrom: { x: 50, y: 120 },
    });
    expect(getCanvasNoteArrowAnchors([{ x: 0, y: 0 }, { x: 100, y: 40 }], 'elbow')).toMatchObject({
      startFrom: { x: 50, y: 0 },
      endFrom: { x: 50, y: 40 },
    });
    expect(getCanvasNoteArrowAnchors([{ x: 0, y: 0 }, { x: 100, y: 40 }], 'straight')).toMatchObject({
      startFrom: { x: 100, y: 40 },
      endFrom: { x: 0, y: 0 },
    });
  });

  it('creates arrowheads and stroke dash arrays from visible stroke width', () => {
    expect(createArrowheadPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 8)).toContain('L 20 0 L');
    expect(getCanvasNoteDashArray('solid', 2)).toBeUndefined();
    expect(getCanvasNoteDashArray('dashed', 2)).toBe('10 8');
    expect(getCanvasNoteDashArray('dotted', 4)).toBe('4 12');
  });
});

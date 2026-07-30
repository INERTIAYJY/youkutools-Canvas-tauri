import { describe, expect, it } from 'vitest';
import {
  createArrowheadPath,
  createLinearCanvasNotePath,
  createSmoothCanvasNotePath,
  getCanvasNoteBounds,
  getCanvasNoteDashArray,
  getCanvasNotePointBounds,
  localizeCanvasNotePoints,
  scaleCanvasNotePoints,
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

  it('creates arrowheads and stroke dash arrays from visible stroke width', () => {
    expect(createArrowheadPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 8)).toContain('L 20 0 L');
    expect(getCanvasNoteDashArray('solid', 2)).toBeUndefined();
    expect(getCanvasNoteDashArray('dashed', 2)).toBe('10 8');
    expect(getCanvasNoteDashArray('dotted', 4)).toBe('4 12');
  });
});

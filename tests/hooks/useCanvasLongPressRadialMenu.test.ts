import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_LONG_PRESS_DELAY_MS,
  CANVAS_LONG_PRESS_INDICATOR_DELAY_MS,
  createCanvasLongPressController,
} from '../../src/hooks/useCanvasLongPressRadialMenu';

describe('canvas long-press radial menu controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after the pointer remains still for the full delay', () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const controller = createCanvasLongPressController(onTrigger);

    controller.pointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 3,
      clientX: 180,
      clientY: 240,
    });
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_DELAY_MS - 1);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onTrigger).toHaveBeenCalledWith({ x: 180, y: 240 });
    controller.dispose();
  });

  it('cancels when the pointer is released early', () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const controller = createCanvasLongPressController(onTrigger);

    controller.pointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    });
    controller.pointerEnd(1);
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_DELAY_MS);

    expect(onTrigger).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not show the hold indicator for a normal click', () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const onPendingChange = vi.fn();
    const controller = createCanvasLongPressController(
      onTrigger,
      CANVAS_LONG_PRESS_DELAY_MS,
      onPendingChange,
    );

    controller.pointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 2,
      clientX: 40,
      clientY: 60,
    });
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_INDICATOR_DELAY_MS - 1);
    expect(onPendingChange).not.toHaveBeenCalledWith({ x: 40, y: 60 });
    controller.pointerEnd(2);
    vi.runAllTimers();

    expect(onTrigger).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith({ x: 40, y: 60 });
    controller.dispose();
  });

  it('shows the hold indicator only after the pointer stays down briefly', () => {
    vi.useFakeTimers();
    const onPendingChange = vi.fn();
    const controller = createCanvasLongPressController(
      vi.fn(),
      CANVAS_LONG_PRESS_DELAY_MS,
      onPendingChange,
    );

    controller.pointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 6,
      clientX: 80,
      clientY: 90,
    });
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_INDICATOR_DELAY_MS);

    expect(onPendingChange).toHaveBeenCalledWith({ x: 80, y: 90 });
    controller.dispose();
  });

  it('cancels after moving beyond the tolerance while ignoring small jitter', () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const controller = createCanvasLongPressController(onTrigger);

    controller.pointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    });
    controller.pointerMove({ pointerId: 7, clientX: 104, clientY: 103 });
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_DELAY_MS / 2);
    controller.pointerMove({ pointerId: 7, clientX: 110, clientY: 100 });
    vi.advanceTimersByTime(CANVAS_LONG_PRESS_DELAY_MS);

    expect(onTrigger).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('ignores secondary and non-primary pointers', () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const controller = createCanvasLongPressController(onTrigger);

    expect(controller.pointerDown({
      button: 2,
      isPrimary: true,
      pointerId: 4,
      clientX: 10,
      clientY: 10,
    })).toBe(false);
    expect(controller.pointerDown({
      button: 0,
      isPrimary: false,
      pointerId: 5,
      clientX: 10,
      clientY: 10,
    })).toBe(false);
    vi.runAllTimers();

    expect(onTrigger).not.toHaveBeenCalled();
    controller.dispose();
  });
});

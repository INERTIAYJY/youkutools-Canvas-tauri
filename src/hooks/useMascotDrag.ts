/**
 * useMascotDrag — 吉祥物拖拽与回弹交互 hook。
 * 用 framer-motion 追踪拖拽位移，把吉祥物位置约束在视口内，
 * 松手时根据拖拽力度触发回弹，并同步吉祥物位置到 store。
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMotionValue, type PanInfo } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { clamp } from '../utils/num';
import type { MascotPosition } from '../types';

const MASCOT_SIZE = 100;
const VIEWPORT_INSET = 8;
const DEFAULT_RIGHT = 20;
const DEFAULT_BOTTOM = 160;
const DRAG_THRESHOLD = 5;
const DRAG_FORCE_VELOCITY = 700;

export interface MascotDragForce {
  x: number;
  y: number;
  active: boolean;
}

function getMovementBounds() {
  if (typeof window === 'undefined') return { maxX: 0, maxY: 0 };
  return {
    maxX: Math.max(0, window.innerWidth - VIEWPORT_INSET * 2 - MASCOT_SIZE),
    maxY: Math.max(0, window.innerHeight - VIEWPORT_INSET * 2 - MASCOT_SIZE),
  };
}

function getDefaultPosition(): MascotPosition {
  const { maxX, maxY } = getMovementBounds();
  const x = clamp(maxX - (DEFAULT_RIGHT - VIEWPORT_INSET), 0, maxX);
  const y = clamp(maxY - (DEFAULT_BOTTOM - VIEWPORT_INSET), 0, maxY);
  return {
    x: maxX > 0 ? x / maxX : 0,
    y: maxY > 0 ? y / maxY : 0,
  };
}

function normalizePosition(position: MascotPosition | undefined): MascotPosition | null {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return {
    x: clamp(position.x, 0, 1),
    y: clamp(position.y, 0, 1),
  };
}

export function useMascotDrag() {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const storedPosition = useAppStore((state) => state.config.mascotPosition);
  const configHydrated = useAppStore((state) => state.configHydrated);
  const initialPosition = normalizePosition(storedPosition) ?? getDefaultPosition();
  const relativePositionRef = useRef(initialPosition);
  const hasCustomPositionRef = useRef(Boolean(normalizePosition(storedPosition)));
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragForceRef = useRef<MascotDragForce>({ x: 0, y: 0, active: false });
  const suppressClickUntilRef = useRef(0);
  const pointerGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const initialBounds = getMovementBounds();
  const x = useMotionValue(initialPosition.x * initialBounds.maxX);
  const y = useMotionValue(initialPosition.y * initialBounds.maxY);

  const applyRelativePosition = useCallback((position: MascotPosition) => {
    const bounds = getMovementBounds();
    x.set(position.x * bounds.maxX);
    y.set(position.y * bounds.maxY);
  }, [x, y]);

  useEffect(() => {
    const normalized = normalizePosition(storedPosition);
    if (normalized) {
      hasCustomPositionRef.current = true;
      relativePositionRef.current = normalized;
      applyRelativePosition(normalized);
      return;
    }

    if (configHydrated) {
      const defaultPosition = getDefaultPosition();
      hasCustomPositionRef.current = false;
      relativePositionRef.current = defaultPosition;
      applyRelativePosition(defaultPosition);
    }
  }, [applyRelativePosition, configHydrated, storedPosition]);

  useEffect(() => {
    const handleResize = () => {
      const nextPosition = hasCustomPositionRef.current
        ? relativePositionRef.current
        : getDefaultPosition();
      relativePositionRef.current = nextPosition;
      applyRelativePosition(nextPosition);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applyRelativePosition]);

  useEffect(() => {
    const markDraggedPointer = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (distance >= DRAG_THRESHOLD) {
        suppressClickUntilRef.current = Date.now() + 1000;
      }
    };
    const finishPointerGesture = (event: PointerEvent) => {
      markDraggedPointer(event);
      if (pointerGestureRef.current?.pointerId === event.pointerId) {
        pointerGestureRef.current = null;
      }
    };

    window.addEventListener('pointermove', markDraggedPointer, true);
    window.addEventListener('pointerup', finishPointerGesture, true);
    window.addEventListener('pointercancel', finishPointerGesture, true);
    return () => {
      window.removeEventListener('pointermove', markDraggedPointer, true);
      window.removeEventListener('pointerup', finishPointerGesture, true);
      window.removeEventListener('pointercancel', finishPointerGesture, true);
    };
  }, []);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, []);

  const handleDragStart = useCallback(() => {
    dragStartRef.current = { x: x.get(), y: y.get() };
    dragForceRef.current = { x: 0, y: 0, active: true };
    suppressClickUntilRef.current = Date.now() + 1000;
  }, [x, y]);

  const handleDrag = useCallback((
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    dragForceRef.current = {
      x: clamp(info.velocity.x / DRAG_FORCE_VELOCITY, -1, 1),
      y: clamp(info.velocity.y / DRAG_FORCE_VELOCITY, -1, 1),
      active: true,
    };
  }, []);

  const handleDragEnd = useCallback((
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    dragForceRef.current = {
      x: clamp(info.velocity.x / DRAG_FORCE_VELOCITY, -1, 1),
      y: clamp(info.velocity.y / DRAG_FORCE_VELOCITY, -1, 1),
      active: false,
    };
    const distance = Math.hypot(info.offset.x, info.offset.y);
    if (distance < DRAG_THRESHOLD) {
      x.set(dragStartRef.current.x);
      y.set(dragStartRef.current.y);
      return;
    }

    suppressClickUntilRef.current = Date.now() + 300;
    const bounds = getMovementBounds();
    const position = {
      x: bounds.maxX > 0 ? clamp(x.get() / bounds.maxX, 0, 1) : 0,
      y: bounds.maxY > 0 ? clamp(y.get() / bounds.maxY, 0, 1) : 0,
    } satisfies MascotPosition;
    relativePositionRef.current = position;
    hasCustomPositionRef.current = true;

    const store = useAppStore.getState();
    store.updateConfig({ mascotPosition: position });
    void store.saveConfig({ silent: true });
  }, [x, y]);

  const consumeDragClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 || Date.now() > suppressClickUntilRef.current) return false;
    suppressClickUntilRef.current = 0;
    event.preventDefault();
    return true;
  }, []);

  const getDragForce = useCallback(() => dragForceRef.current, []);

  return {
    constraintsRef,
    x,
    y,
    handlePointerDownCapture,
    handleDragStart,
    handleDrag,
    handleDragEnd,
    getDragForce,
    consumeDragClick,
  };
}

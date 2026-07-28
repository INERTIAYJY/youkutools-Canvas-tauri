/**
 * ResizeHandle — 通用缩放把手：四角 + 四边共 8 个方向，Shift 锁定比例
 *
 * 核心问题：React Flow 的 pane 会在捕获阶段处理 Shift + pointerdown，
 * 比把手自身的 pointerdown 监听更早进入框选逻辑。
 *
 * 解决：为把手添加 React Flow 识别的 nokey 类，让 pane 跳过框选；nodrag / nopan
 * 同时隔离节点拖拽和画布平移。原生监听器继续负责实际缩放。
 *
 * 左/上方向缩放时节点位置要反向移动（对边保持不动），故这里同时写位置。
 */
import { useContext, useEffect, useRef } from 'react';
import { ResizeSnapContext, type ResizeDirection } from '../../../hooks/useNodeSnap';
import { useShiftProportional, useProportionalLock, computeResize } from '../../../hooks/useShiftProportional';
import { useAppStore } from '../../../store/useAppStore';

/** 8 个把手方向：x/y 为 -1 表示该轴的左/上边在动，1 表示右/下边在动，0 表示该轴不变 */
const HANDLE_DIRECTIONS: { name: string; x: -1 | 0 | 1; y: -1 | 0 | 1 }[] = [
  { name: 'nw', x: -1, y: -1 },
  { name: 'n', x: 0, y: -1 },
  { name: 'ne', x: 1, y: -1 },
  { name: 'w', x: -1, y: 0 },
  { name: 'e', x: 1, y: 0 },
  { name: 'sw', x: -1, y: 1 },
  { name: 's', x: 0, y: 1 },
  { name: 'se', x: 1, y: 1 },
];

interface ResizeHandleProps {
  nodeId?: string;
  currentWidth: number;
  currentHeight: number;
  minWidth?: number;
  minHeight?: number;
  lockAspectRatio?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onResize: (width: number, height: number) => void;
}

export default function ResizeHandle({
  nodeId,
  currentWidth,
  currentHeight,
  minWidth = 160,
  minHeight = 120,
  lockAspectRatio = false,
  onResizeStart,
  onResizeEnd,
  onResize,
}: ResizeHandleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, left: 0, top: 0 });
  const snap = useContext(ResizeSnapContext);
  const shiftHeld = useShiftProportional();
  const { lockRef, reset: resetProportional, lock: lockProportional } = useProportionalLock();

  // 最新值 refs（供原生事件闭包读取，避免闭包过期）
  const latestRef = useRef({ currentWidth, currentHeight, minWidth, minHeight, lockAspectRatio, onResizeStart, onResizeEnd, onResize, nodeId, snap });
  useEffect(() => {
    latestRef.current = { currentWidth, currentHeight, minWidth, minHeight, lockAspectRatio, onResizeStart, onResizeEnd, onResize, nodeId, snap };
  }, [currentHeight, currentWidth, lockAspectRatio, minHeight, minWidth, nodeId, onResize, onResizeEnd, onResizeStart, snap]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onNativePointerDown = (e: PointerEvent) => {
      const handle = (e.target as HTMLElement | null)?.closest<HTMLElement>('.node-resize-handle');
      if (!handle || !root.contains(handle)) return;
      const dirX = Number(handle.dataset.dirX ?? 1) as -1 | 0 | 1;
      const dirY = Number(handle.dataset.dirY ?? 1) as -1 | 0 | 1;
      const direction: ResizeDirection = { x: dirX, y: dirY };
      const axis = dirX === 0 ? 'y' : dirY === 0 ? 'x' : 'both';

      e.preventDefault();
      e.stopPropagation(); // ← 关键：阻止事件冒泡到 React 根节点，React Flow 收不到

      const {
        currentWidth: cw,
        currentHeight: ch,
        minWidth: mw,
        minHeight: mh,
        lockAspectRatio: keepRatio,
        onResizeStart: startResize,
        onResizeEnd: endResize,
        onResize: rs,
        nodeId: nid,
        snap: sp,
      } = latestRef.current;
      isResizing.current = true;
      handle.classList.add('is-resizing');
      // 左/上缩放要以起始位置为基准反推新位置，避免逐帧累加漂移
      const startPos = nid
        ? useAppStore.getState().nodes.find((n) => n.id === nid)?.position
        : undefined;
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: cw,
        h: ch,
        left: startPos?.x ?? 0,
        top: startPos?.y ?? 0,
      };
      resetProportional();
      if (nid) sp?.onResizeStart(nid);

      let historyCommitted = false;
      let lastWidth = cw;
      let lastHeight = ch;

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isResizing.current) return;

        let baseW = resizeStart.current.w;
        let baseH = resizeStart.current.h;
        let dx = (ev.clientX - resizeStart.current.x) * dirX;
        let dy = (ev.clientY - resizeStart.current.y) * dirY;
        let ratio = baseH > 0 ? baseW / baseH : 1;
        let useProportional = keepRatio;

        if (!keepRatio && shiftHeld.current) {
          if (lockRef.current.w === 0) {
            lockProportional(baseW, baseH, resizeStart.current.x, resizeStart.current.y);
          }
          baseW = lockRef.current.w;
          baseH = lockRef.current.h;
          dx = (ev.clientX - lockRef.current.x) * dirX;
          dy = (ev.clientY - lockRef.current.y) * dirY;
          ratio = lockRef.current.ratio;
          useProportional = true;
        } else {
          resetProportional();
        }

        let { width: newWidth, height: newHeight } = computeResize(
          baseW, baseH, dx, dy, ratio, mw, mh, useProportional, axis,
        );

        if (nid && sp && !keepRatio) {
          const snapped = sp.applyResizeSnap(nid, newWidth, newHeight, direction);
          newWidth = Math.max(mw, snapped.width);
          newHeight = Math.max(mh, snapped.height);
        }

        if (newWidth === lastWidth && newHeight === lastHeight) return;
        if (!historyCommitted) {
          startResize?.();
          historyCommitted = true;
        }
        lastWidth = newWidth;
        lastHeight = newHeight;
        rs(newWidth, newHeight);

        // 左/上边在动 → 对边固定：位置补偿掉尺寸变化
        if (nid && (dirX === -1 || dirY === -1) && startPos) {
          useAppStore.getState().updateNodePositionTransient(nid, {
            x: dirX === -1 ? resizeStart.current.left + (resizeStart.current.w - newWidth) : startPos.x,
            y: dirY === -1 ? resizeStart.current.top + (resizeStart.current.h - newHeight) : startPos.y,
          });
        }
      };

      const handlePointerUp = () => {
        isResizing.current = false;
        handle.classList.remove('is-resizing');
        if (historyCommitted) endResize?.();
        if (nid) sp?.onResizeStop();
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = getComputedStyle(handle).cursor;
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    };

    // capture:true — 在原生捕获阶段拦截，早于 React 事件代理的冒泡阶段
    root.addEventListener('pointerdown', onNativePointerDown, true);
    return () => root.removeEventListener('pointerdown', onNativePointerDown, true);
  }, [shiftHeld, lockRef, resetProportional, lockProportional]);

  return (
    <div className="node-resize-handles" ref={rootRef}>
      {HANDLE_DIRECTIONS.map(({ name, x, y }) => (
        <div
          key={name}
          className={`node-resize-handle node-resize-handle--${name} nokey nodrag nopan`}
          data-dir-x={x}
          data-dir-y={y}
        />
      ))}
    </div>
  );
}

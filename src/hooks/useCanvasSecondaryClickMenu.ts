import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Node as RFNode } from '@xyflow/react';
import type { BaseNodeData } from '../types';

interface UseCanvasSecondaryClickMenuOptions {
  interactionModeRef: MutableRefObject<string>;
  openNodeMenu: (event: React.MouseEvent, node: RFNode<BaseNodeData>) => void;
  openCanvasMenu: (event: React.MouseEvent) => void;
}

/** 统一 Windows 右键拖拽与 macOS 次级点击的菜单触发时机。 */
export function useCanvasSecondaryClickMenu({
  interactionModeRef,
  openNodeMenu,
  openCanvasMenu,
}: UseCanvasSecondaryClickMenuOptions): void {
  const shouldPreventNativeMenu = useRef(false);

  useEffect(() => {
    const drag = { x: 0, y: 0, moved: false, down: false };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved = false;
      drag.down = true;
    };
    const onMove = (event: PointerEvent) => {
      if (!drag.down) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (deltaX * deltaX + deltaY * deltaY > 25) drag.moved = true;
    };
    const onCancel = () => {
      drag.down = false;
    };
    const onUp = (event: PointerEvent) => {
      if (event.button !== 2 || !drag.down) return;
      drag.down = false;
      if (drag.moved && interactionModeRef.current === 'default') return;

      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (!element) return;

      const nodeElement = element.closest('.react-flow__node');
      if (nodeElement) {
        const id = nodeElement.getAttribute('data-id');
        if (!id) return;
        shouldPreventNativeMenu.current = true;
        openNodeMenu({
          preventDefault() {},
          stopPropagation() {},
          clientX: event.clientX,
          clientY: event.clientY,
          target: element,
        } as unknown as React.MouseEvent, { id } as RFNode<BaseNodeData>);
        return;
      }

      const paneElement = element.closest('.react-flow__pane');
      if (!paneElement) return;
      shouldPreventNativeMenu.current = true;
      openCanvasMenu({
        preventDefault() {},
        clientX: event.clientX,
        clientY: event.clientY,
        target: paneElement,
      } as unknown as React.MouseEvent);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!shouldPreventNativeMenu.current) return;
      event.preventDefault();
      shouldPreventNativeMenu.current = false;
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [interactionModeRef, openCanvasMenu, openNodeMenu]);
}

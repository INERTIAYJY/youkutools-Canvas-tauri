/**
 * character/CharacterReferenceGallery — 角色参考图画廊。
 * 参考图按预览区高度等比排列为一行，超出宽度时横向滚动。
 * 支持选中、编辑、拖拽排序与裁剪预览，并向上汇报实际图片区域尺寸。
 */
import { useT } from '../../i18n';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue } from 'framer-motion';
import { Icon } from '@iconify/react';
import type { CharacterReferenceImage } from '../../types/dramaAssets';
import ViewportImage from '../shared/ViewportImage';
import { CHARACTER_REFERENCE_KIND_LABELS } from './characterReferencePresentation';
import AssetFileContextMenu from '../assets/AssetFileContextMenu';
import { copyFile, copyText } from '../../services/clipboardService';
import { deletePermanentFile, isTauriEnv, revealFileInFolder } from '../../services/fileService';
import { useAppStore } from '../../store/useAppStore';

const GAP = 8;

interface ReferenceDragSession {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  lastCenter: number;
  active: boolean;
  order: string[];
}

export interface ReferenceStageBox {
  width: number;
  height: number;
}

interface CharacterReferenceGalleryProps {
  references: CharacterReferenceImage[];
  selectedId: string | null;
  onSelect: (referenceId: string) => void;
  onEdit: (referenceId: string) => void;
  onReorder: (referenceIds: string[]) => Promise<boolean>;
  /** 汇报实际铺开的图片区域尺寸 */
  onStageResize?: (stage: ReferenceStageBox | null) => void;
}

export default function CharacterReferenceGallery({
  references,
  selectedId,
  onSelect,
  onEdit,
  onReorder,
  onStageResize,
}: CharacterReferenceGalleryProps) {
  const t = useT();
  const [fileMenu, setFileMenu] = useState<{ reference: CharacterReferenceImage; x: number; y: number } | null>(null);
  const closeFileMenu = useCallback(() => setFileMenu(null), []);
  const menuReference = fileMenu && references.find((reference) => reference === fileMenu.reference);
  const showToast = useAppStore((state) => state.showToast);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const dragRef = useRef<ReferenceDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const mountedRef = useRef(true);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<ReferenceDragSession | null>(null);
  const [saving, setSaving] = useState(false);
  const transform = useMotionValue('translate3d(0px, 0px, 0px)');
  const canReorder = references.length > 1;
  const orderedReferences = preview?.length === references.length && preview.every((id) => references.some((item) => item.id === id))
    ? preview.flatMap((id) => references.find((item) => item.id === id) ?? []) : references;
  const floatingReference = dragging && references.find((reference) => reference.id === dragging.id);

  const releasePointer = useCallback((drag: ReferenceDragSession) => {
    const container = containerRef.current;
    if (container?.hasPointerCapture(drag.pointerId)) container.releasePointerCapture(drag.pointerId);
  }, []);
  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) releasePointer(drag);
    setDragging(null);
    setPreview(null);
  }, [releasePointer]);
  useEffect(() => () => {
    if (dragRef.current) cancelDrag();
  }, [references, ratios, box.height, cancelDrag]);
  useEffect(() => {
    mountedRef.current = true;
    const cancel = (event: Event) => {
      if (!dragRef.current) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      cancelDrag();
    };
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [cancelDrag]);

  const updateDrag = useCallback((drag: ReferenceDragSession) => {
    const container = containerRef.current;
    if (!container) return;
    transform.set(`translate3d(${drag.clientX - drag.grabX}px, ${drag.clientY - drag.grabY}px, 0px)`);
    const center = drag.clientX - drag.grabX + drag.width / 2;
    const contentCenter = center - container.getBoundingClientRect().left + container.scrollLeft;
    const direction = contentCenter - drag.lastCenter;
    drag.lastCenter = contentCenter;
    if (direction === 0) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-reference-id]'));
    const from = drag.order.indexOf(drag.id);
    let destination = from;
    buttons.forEach((button) => {
      const index = drag.order.indexOf(button.dataset.referenceId ?? '');
      const rect = button.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      // 只沿鼠标移动方向跨越相邻中心，避免不同比例图片换位后原地反复跳动。
      if (direction > 0 && index > from && center > midpoint) destination = index;
      else if (direction < 0 && index < from && center < midpoint && destination === from) destination = index;
    });
    if (destination !== from) {
      const next = [...drag.order];
      next.splice(from, 1);
      next.splice(destination, 0, drag.id);
      drag.order = next;
      setPreview(next);
    }
  }, [transform]);

  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    let previousTime = performance.now();
    const scroll = (time: number) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      const edge = Math.min(48, rect.width / 4);
      const speed = drag.clientX < rect.left + edge ? -Math.min(1, (rect.left + edge - drag.clientX) / edge)
        : drag.clientX > rect.right - edge ? Math.min(1, (drag.clientX - rect.right + edge) / edge) : 0;
      container.scrollLeft += speed * Math.min(time - previousTime, 32) * 0.65;
      previousTime = time;
      updateDrag(drag);
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, updateDrag]);

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
    suppressClickRef.current = false;
    if (saving || dragRef.current || !canReorder) return;
    const container = containerRef.current;
    if (!container) return;
    setFileMenu(null);
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      width: rect.width, height: rect.height, active: false, order: references.map((item) => item.id),
      lastCenter: rect.left + rect.width / 2 - container.getBoundingClientRect().left + container.scrollLeft,
    };
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.clientX - drag.startX, drag.clientY - drag.startY) < 6) return;
      drag.active = true;
      suppressClickRef.current = true;
      // 超过阈值才捕获，普通点击与双击仍落在图片按钮上。
      containerRef.current?.setPointerCapture(event.pointerId);
      setDragging({ ...drag });
    }
    event.preventDefault();
    updateDrag(drag);
  }
  async function saveOrder(ids: string[]) {
    setPreview(ids);
    setSaving(true);
    try { await onReorder(ids); }
    catch { if (mountedRef.current) showToast(t('角色素材保存失败'), 'error'); }
    finally {
      if (mountedRef.current) { setSaving(false); setPreview(null); }
    }
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releasePointer(drag);
    setDragging(null);
    if (drag.active && references.some((item, index) => item.id !== drag.order[index])) void saveOrder(drag.order);
    else setPreview(null);
  }

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [references.length]);

  // 记录比例时顺手丢掉已不存在的条目：图片可能被替换，旧值会影响重新加入时的排版。
  // 放在 onLoad 里而不是 effect 里，避免多一轮级联渲染。
  const recordRatio = (referenceId: string, ratio: number) => {
    setRatios((previous) => {
      if (previous[referenceId] === ratio) return previous;
      const alive = Object.entries(previous).filter(([id]) => references.some((item) => item.id === id));
      return { ...Object.fromEntries(alive), [referenceId]: ratio };
    });
  };

  const layout = useMemo(() => {
    if (!references.length || box.width <= 0 || box.height <= 0) return null;
    // 比例未知的先按 1 排，图片加载后保持满高并按真实比例更新宽度。
    const width = references.reduce((sum, item) => sum + (ratios[item.id] ?? 1) * box.height, 0)
      + GAP * (references.length - 1);
    return {
      width,
      height: box.height,
      rows: [{ items: references.map((_, index) => index), height: box.height }],
    };
  }, [box.height, box.width, ratios, references]);

  useEffect(() => {
    onStageResize?.(layout ? { width: layout.width, height: layout.height } : null);
  }, [layout, onStageResize]);

  if (references.length === 0) {
    return (
      <div className="character-reference-empty">
        <Icon icon="lucide:images" width="30" height="30" aria-hidden="true" />
        <span>{t('还没有参考图')}</span>
      </div>
    );
  }

  return (
    <>
    <div className={`character-reference-grid${dragging ? ' select-none cursor-[var(--cursor-grabbing,grabbing)]' : ''}`}
      role="list" aria-label={t('角色参考图')} aria-busy={saving} ref={containerRef}
      onPointerMove={moveDrag} onPointerUp={finishDrag}
      onPointerLeave={() => { if (dragRef.current && !dragRef.current.active) cancelDrag(); }}
      onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}
      onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (suppressClickRef.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      }}>
      {layout?.rows.map((row, rowIndex) => (
        <div
          className="character-reference-row"
          key={row.items.join('-') || rowIndex}
          style={{ width: layout.width, height: row.height }}
        >
          {row.items.map((index) => {
            const reference = orderedReferences[index];
            return (
              <button
                key={reference.id}
                type="button"
                role="listitem"
                className={`character-reference-item ${reference.id === selectedId ? 'is-selected' : ''}${canReorder ? ' select-none' : ''}${dragging ? ' [&.character-reference-item]:cursor-[var(--cursor-grabbing,grabbing)]' : canReorder ? ' [&.character-reference-item]:cursor-[var(--cursor-grab,grab)]' : ''}${dragging?.id === reference.id ? ' opacity-30' : ''}`}
                data-reference-id={reference.id}
                style={{ flex: `${ratios[reference.id] ?? 1} 1 0` }}
                title={canReorder ? t('拖拽调整顺序；Alt + 左右方向键移动') : undefined}
                onPointerDown={(event) => startDrag(event, reference.id)}
                onClick={() => onSelect(reference.id)}
                onDoubleClick={() => { if (!suppressClickRef.current) onEdit(reference.id); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus();
                  onSelect(reference.id);
                  setFileMenu({ reference, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (saving || dragging) return;
                    const destination = index + (event.key === 'ArrowLeft' ? -1 : 1);
                    if (destination < 0 || destination >= references.length) return;
                    const ids = references.map((item) => item.id);
                    [ids[index], ids[destination]] = [ids[destination], ids[index]];
                    void saveOrder(ids);
                    return;
                  }
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  onSelect(reference.id);
                  setFileMenu({ reference, x: rect.left, y: rect.top });
                }}
                aria-label={t('{kind}参考图', { kind: t(CHARACTER_REFERENCE_KIND_LABELS[reference.kind]) })}
              >
                {reference.imageUrl ? (
                  <ViewportImage
                    src={reference.imageUrl}
                    alt=""
                    draggable={false}
                    eager={reference.id === selectedId}
                    onLoad={(event) => {
                      const { naturalWidth, naturalHeight } = event.currentTarget;
                      if (!naturalWidth || !naturalHeight) return;
                      recordRatio(reference.id, naturalWidth / naturalHeight);
                    }}
                  />
                ) : (
                  <Icon icon="lucide:image-off" width="24" height="24" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
    {dragging && floatingReference ? createPortal(
      <motion.div aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[10070] overflow-hidden rounded-lg border border-canvas-border bg-canvas-surface opacity-80"
        style={{ transform, width: dragging.width, height: dragging.height }}>
        {floatingReference.imageUrl ? <ViewportImage src={floatingReference.imageUrl} alt="" eager draggable={false} className="size-full object-cover" />
          : <Icon icon="lucide:image-off" className="size-full" aria-hidden="true" />}
      </motion.div>, document.body,
    ) : null}
    {fileMenu && menuReference && <AssetFileContextMenu
      key={`${menuReference.id}:${fileMenu.x}:${fileMenu.y}`}
      name={menuReference.filePath?.split(/[\\/]/).pop() || t('角色参考图')}
      x={fileMenu.x}
      y={fileMenu.y}
      canFileActions={isTauriEnv() && !!menuReference.filePath}
      canCopyPrompt={!!menuReference.prompt.trim()}
      onCopy={async () => {
        if (!menuReference.filePath || !(await copyFile(menuReference.filePath))) throw new Error(t('复制失败'));
        showToast(t('文件已复制，可在系统中粘贴'));
      }}
      onCopyPrompt={async () => {
        if (!(await copyText(menuReference.prompt))) throw new Error(t('复制失败'));
        showToast(t('提示词已复制'));
      }}
      onReveal={async () => {
        if (!menuReference.filePath) throw new Error(t('文件不可用'));
        await revealFileInFolder(menuReference.filePath);
      }}
      onDelete={async () => {
        if (!menuReference.filePath) throw new Error(t('文件不可用'));
        await deletePermanentFile(menuReference.filePath);
        showToast(t('文件已移入系统回收站'));
      }}
      onClose={closeFileMenu}
    />}
    </>
  );
}

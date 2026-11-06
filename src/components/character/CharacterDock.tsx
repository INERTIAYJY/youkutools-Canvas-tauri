/**
 * CharacterDock — 提供角色快捷栏界面与交互。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import type { DramaCharacter } from '../../types/dramaAssets';
import { useT } from '../../i18n';

const dockSpring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;

interface DragSession {
  id: string;
  pointerId: number;
  button: HTMLButtonElement;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  active: boolean;
  order: string[];
}

interface Props {
  characters: DramaCharacter[];
  selectedId?: string;
  renderAvatar: (character: DramaCharacter) => ReactNode;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => Promise<boolean>;
}

/** 拖动期间仅预览，释放后一次提交；指针捕获保证越过滚动边界后仍可落下。 */
export default function CharacterDock({ characters, selectedId, renderAvatar, onSelect, onReorder }: Props) {
  const t = useT();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);
  const mounted = useRef(true);
  const animations = useRef<Array<{ stop: () => void }>>([]);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [floating, setFloating] = useState<DragSession | null>(null);
  const [settling, setSettling] = useState(false);
  const [saving, setSaving] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const ordered = preview
    ? preview.flatMap((id) => characters.find((item) => item.id === id) ?? [])
    : characters;

  function revealButton(button: HTMLButtonElement) {
    const list = listRef.current;
    if (!list) return;
    if (button.offsetLeft < list.scrollLeft) list.scrollLeft = button.offsetLeft;
    else if (button.offsetLeft + button.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = button.offsetLeft + button.offsetWidth - list.clientWidth;
    }
  }

  const releasePointer = useCallback((drag: DragSession) => {
    const list = listRef.current;
    if (list?.hasPointerCapture(drag.pointerId)) list.releasePointerCapture(drag.pointerId);
  }, []);

  const cancelDrag = useCallback(() => {
    const drag = session.current;
    session.current = null;
    if (drag) releasePointer(drag);
    setPreview(null);
    setFloating(null);
  }, [releasePointer]);

  // 外部更新列表或卸载时取消旧拖动；提交排序时 session 已清空。
  useEffect(() => {
    return () => {
      if (session.current) cancelDrag();
    };
  }, [characters, cancelDrag]);

  useEffect(() => {
    mounted.current = true;
    const cancel = (event: Event) => {
      if (!session.current) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      cancelDrag();
    };
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      mounted.current = false;
      animations.current.forEach((animation) => animation.stop());
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, [cancelDrag]);

  const updatePosition = useCallback((drag: DragSession) => {
    const list = listRef.current;
    if (!list) return;
    x.set(drag.clientX - drag.grabX);
    y.set(drag.clientY - drag.grabY - (reducedMotion ? 0 : 10));
    const rect = list.getBoundingClientRect();
    const center = drag.clientX - rect.left + list.scrollLeft - drag.grabX + drag.width / 2;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-character-id]'));
    let destination = 0;
    let distance = Infinity;
    buttons.forEach((button, index) => {
      // offsetLeft 不含 layout 动画位移，避免让位动画反复触发换位。
      const nextDistance = Math.abs(center - (button.offsetLeft + button.offsetWidth / 2));
      if (nextDistance < distance) { distance = nextDistance; destination = index; }
    });
    const from = drag.order.indexOf(drag.id);
    if (from !== destination) {
      const next = [...drag.order];
      next.splice(from, 1);
      next.splice(destination, 0, drag.id);
      drag.order = next;
      setPreview(next);
    }
  }, [reducedMotion, x, y]);

  useEffect(() => {
    if (!floating || settling) return;
    let frame = 0;
    let previousTime = performance.now();
    const scroll = (time: number) => {
      const drag = session.current;
      const list = listRef.current;
      if (!drag || !list) return;
      const rect = list.getBoundingClientRect();
      const edge = Math.min(48, rect.width / 4);
      const speed = drag.clientX < rect.left + edge
        ? -Math.min(1, (rect.left + edge - drag.clientX) / edge)
        : drag.clientX > rect.right - edge
          ? Math.min(1, (drag.clientX - rect.right + edge) / edge) : 0;
      list.scrollLeft += speed * Math.min(time - previousTime, 32) * 0.65;
      previousTime = time;
      updatePosition(drag);
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [floating, settling, updatePosition]);

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary || saving || floating || session.current) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    session.current = {
      id, pointerId: event.pointerId, button: event.currentTarget,
      startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      width: rect.width, height: rect.height, active: false, order: characters.map((item) => item.id),
    };
    // 捕获到不会换位的容器；捕获到按钮会在 React 移动 DOM 时丢失指针。
    listRef.current?.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = session.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.active = true;
      suppressClick.current = true;
      setPreview(drag.order);
      setFloating({ ...drag });
    }
    event.preventDefault();
    updatePosition(drag);
  }

  async function saveOrder(ids: string[], focusId?: string) {
    setSaving(true);
    try { await onReorder(ids); }
    finally {
      if (mounted.current) {
        setSaving(false);
        setPreview(null);
        if (focusId) requestAnimationFrame(() => {
          const button = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-character-id]') ?? [])
            .find((item) => item.dataset.characterId === focusId);
          if (button) revealButton(button);
          button?.focus({ preventScroll: true });
        });
      }
    }
  }

  async function finish(event: PointerEvent<HTMLDivElement>) {
    const drag = session.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    session.current = null;
    releasePointer(drag);
    if (!drag.active) { onSelect(drag.id); return; }
    setSettling(true);
    const list = listRef.current;
    if (list) {
      revealButton(drag.button);
      const rect = list.getBoundingClientRect();
      const targetX = rect.left + drag.button.offsetLeft - list.scrollLeft;
      const targetY = rect.top + drag.button.offsetTop - list.scrollTop;
      const transition = reducedMotion ? { duration: 0 } : dockSpring;
      const landing = [animate(x, targetX, transition), animate(y, targetY, transition)];
      animations.current = landing;
      await Promise.all(landing);
    }
    if (!mounted.current) return;
    setFloating(null);
    setSettling(false);
    if (characters.some((item, index) => item.id !== drag.order[index])) await saveOrder(drag.order);
    else setPreview(null);
  }

  const floatingCharacter = floating && characters.find((item) => item.id === floating.id);
  return (
    <>
      <motion.div
        ref={listRef}
        layoutScroll
        className={`character-library-strip-list${floating ? ' is-reordering' : ''}`}
        role="group"
        aria-label={t('角色列表')}
        aria-busy={saving}
        onPointerMove={move}
        onPointerUp={(event) => { void finish(event); }}
        onPointerCancel={(event) => { if (session.current?.pointerId === event.pointerId) cancelDrag(); }}
        onLostPointerCapture={(event) => { if (session.current?.pointerId === event.pointerId) cancelDrag(); }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
        }}
      >
        {ordered.map((character, index) => (
          <motion.button
            layout={reducedMotion ? false : 'position'}
            transition={dockSpring}
            key={character.id}
            type="button"
            data-character-id={character.id}
            className={`${character.id === selectedId ? 'is-selected' : ''}${floating?.id === character.id ? ' is-drag-placeholder' : ''}`}
            aria-pressed={character.id === selectedId}
            aria-label={character.name}
            title={t('拖拽调整顺序；Alt + 左右方向键移动')}
            onPointerDown={(event) => start(event, character.id)}
            onClick={() => onSelect(character.id)}
            onKeyDown={(event) => {
              if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || saving || floating) return;
              event.preventDefault();
              const destination = index + (event.key === 'ArrowLeft' ? -1 : 1);
              if (destination < 0 || destination >= ordered.length) return;
              const ids = ordered.map((item) => item.id);
              [ids[index], ids[destination]] = [ids[destination], ids[index]];
              setPreview(ids);
              void saveOrder(ids, character.id);
            }}
          >
            {renderAvatar(character)}
            <span>{character.name}</span>
          </motion.button>
        ))}
      </motion.div>
      {floatingCharacter && floating ? createPortal(
        <motion.div
          aria-hidden="true"
          className="character-dock-floating"
          initial={{ scale: 1 }}
          animate={{ scale: settling || reducedMotion ? 1 : 1.07 }}
          transition={reducedMotion ? { duration: 0 } : dockSpring}
          style={{ x, y, width: floating.width, height: floating.height }}
        >
          {renderAvatar(floatingCharacter)}
          <span>{floatingCharacter.name}</span>
        </motion.div>, document.body,
      ) : null}
    </>
  );
}

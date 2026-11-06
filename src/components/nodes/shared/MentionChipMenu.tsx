/**
 * MentionChipMenu — 提供引用胶囊菜单界面与交互。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useT } from '../../../i18n';
import { calcFixedPosition } from '../../../utils/popupPosition';

export default function MentionChipMenu({ x, y, onReplace, onDelete, onClose }: {
  x: number;
  y: number;
  onReplace: () => void;
  onDelete: () => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const size = menu.getBoundingClientRect();
    setPosition(calcFixedPosition(x, y, size.width, size.height));
    menu.querySelector('button')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const dismiss = () => onClose();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose(true);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="mention-dropdown ui-menu nowheel nodrag nopan"
      style={{ position: 'fixed', ...position, zIndex: 10060 }} role="menu" aria-label={t('引用')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Tab') { onClose(); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll('button'));
        const index = items.findIndex((item) => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
      }}>
      <button type="button" role="menuitem" className="ui-menu__item" onClick={onReplace}>
        <Icon icon="lucide:replace" width={14} aria-hidden="true" />{t('替换')}
      </button>
      <button type="button" role="menuitem" className="ui-menu__item is-danger" onClick={onDelete}>
        <Icon icon="lucide:trash-2" width={14} aria-hidden="true" />{t('删除')}
      </button>
    </div>, document.body,
  );
}

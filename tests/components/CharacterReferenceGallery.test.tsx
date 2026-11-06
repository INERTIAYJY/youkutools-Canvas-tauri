/**
 * CharacterReferenceGallery — 回归测试：角色参考图指针排序。
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterReferenceImage } from '../../src/types/dramaAssets';

const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>, stateIndex: 0, refIndex: 0,
  transform: { set: vi.fn() }, showToast: vi.fn(),
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: <T,>(calculate: () => T) => calculate(),
  useState: <T,>(initial: T) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: T) => { harness.states[index] = value; }];
  },
  useRef: <T,>(initial: T) => harness.refs[harness.refIndex++] ??= { current: initial },
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, useMotionValue: () => harness.transform }));
vi.mock('../../src/i18n', () => ({ t: (text: string) => text, useT: () => (text: string) => text }));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ showToast: harness.showToast }),
}));
vi.mock('../../src/components/shared/ViewportImage', () => ({ default: 'image' }));
vi.mock('../../src/components/assets/AssetFileContextMenu', () => ({ default: 'file-menu' }));
vi.mock('../../src/services/clipboardService', () => ({ copyFile: vi.fn(), copyText: vi.fn() }));
vi.mock('../../src/services/fileService', () => ({ deletePermanentFile: vi.fn(), isTauriEnv: () => false, revealFileInFolder: vi.fn() }));

import CharacterReferenceGallery from '../../src/components/character/CharacterReferenceGallery';

type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

beforeEach(() => {
  harness.states = []; harness.refs = [];
  harness.transform.set.mockClear(); harness.showToast.mockClear();
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());

function setup(widths = [100, 200, 80]) {
  harness.states = []; harness.refs = [];
  harness.states[2] = Object.fromEntries(widths.map((width, index) => [`ref-${index}`, width / 100]));
  const references = widths.map((_, index) => ({
    id: `ref-${index}`, kind: 'other', prompt: '', createdAt: 1, updatedAt: 1,
  })) as CharacterReferenceImage[];
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const onReorder = vi.fn(async (_ids: string[]) => true);
  const buttons = references.map((reference, index) => ({
    dataset: { referenceId: reference.id },
    getBoundingClientRect: () => ({ left: widths.slice(0, index).reduce((sum, width) => sum + width + 8, 0), top: 0, width: widths[index], height: 100 }),
  }));
  const container = {
    scrollLeft: 0, getBoundingClientRect: () => ({ left: 0 }), querySelectorAll: () => buttons,
    setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  };
  let tree: Element[] = [];
  function render() {
    harness.stateIndex = harness.refIndex = 0;
    // ResizeObserver 的结果；不启动浏览器或原生图片加载。
    harness.states[1] = { width: 400, height: 100 };
    tree = elements(CharacterReferenceGallery({ references, selectedId: 'ref-1', onSelect, onEdit, onReorder }));
    harness.refs[0].current = container;
  }
  function fire(id: string | null, handler: string, extra: Record<string, unknown> = {}) {
    const element = tree.find((item) => id ? item.props['data-reference-id'] === id : item.props.role === 'list')!;
    return (element.props[handler] as (event: unknown) => unknown)({
      button: 0, isPrimary: true, pointerType: 'mouse', pointerId: 1, clientX: 180, clientY: 40,
      currentTarget: id ? buttons.find((button) => button.dataset.referenceId === id) : container,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
    });
  }
  render();
  return { render, fire, container, buttons, onSelect, onEdit, onReorder, order: () => tree.filter((item) => item.props['data-reference-id']).map((item) => item.props['data-reference-id']) };
}

describe('角色参考图指针排序', () => {
  it('轻点和双击不启动指针捕获，保留选择及编辑', () => {
    const view = setup();
    view.fire('ref-1', 'onPointerDown');
    view.fire(null, 'onPointerMove', { clientX: 183 });
    view.fire(null, 'onPointerUp');
    view.fire('ref-1', 'onClick');
    view.fire('ref-1', 'onDoubleClick');
    expect(view.container.setPointerCapture).not.toHaveBeenCalled();
    expect(view.onReorder).not.toHaveBeenCalled();
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('ref-1');
    expect(view.onEdit).toHaveBeenCalledExactlyOnceWith('ref-1');
  });

  it('不同宽度图片跨位时只预览，松开后只保存一次并屏蔽尾随点击', async () => {
    const view = setup();
    view.fire('ref-1', 'onPointerDown');
    view.fire(null, 'onPointerMove', { clientX: 400 });
    view.render();
    expect(view.order()).toEqual(['ref-0', 'ref-2', 'ref-1']);
    expect(view.onReorder).not.toHaveBeenCalled();
    expect(view.container.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    view.fire(null, 'onPointerUp');
    await Promise.resolve();
    expect(view.onReorder).toHaveBeenCalledExactlyOnceWith(['ref-0', 'ref-2', 'ref-1']);
    const stopPropagation = vi.fn();
    view.fire(null, 'onClickCapture', { detail: 1, stopPropagation });
    view.fire('ref-1', 'onDoubleClick');
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onEdit).not.toHaveBeenCalled();
  });

  it('取消拖动恢复原顺序，不保存；其他指针不接管拖动', () => {
    const view = setup();
    view.fire('ref-1', 'onPointerDown');
    view.fire(null, 'onPointerMove', { clientX: 400, pointerId: 2 });
    expect(view.container.setPointerCapture).not.toHaveBeenCalled();
    view.fire(null, 'onPointerMove', { clientX: 400 });
    view.fire(null, 'onPointerCancel', { pointerId: 2 });
    view.render();
    expect(view.order()).toEqual(['ref-0', 'ref-2', 'ref-1']);
    view.fire(null, 'onPointerCancel');
    view.render();
    view.fire(null, 'onPointerUp');
    expect(view.order()).toEqual(['ref-0', 'ref-1', 'ref-2']);
    expect(view.onReorder).not.toHaveBeenCalled();
  });

  it('Alt 方向键移动相邻图片，单图及边界不提交', async () => {
    const view = setup();
    view.fire('ref-0', 'onKeyDown', { altKey: true, key: 'ArrowLeft' });
    expect(view.onReorder).not.toHaveBeenCalled();
    view.fire('ref-1', 'onKeyDown', { altKey: true, key: 'ArrowRight' });
    expect(view.onReorder).toHaveBeenCalledExactlyOnceWith(['ref-0', 'ref-2', 'ref-1']);
    await Promise.resolve();
    const single = setup([100]);
    single.fire('ref-0', 'onPointerDown');
    single.fire(null, 'onPointerMove', { clientX: 400 });
    single.fire(null, 'onPointerUp');
    expect(single.onReorder).not.toHaveBeenCalled();
  });
});

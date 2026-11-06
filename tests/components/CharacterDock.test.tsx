/**
 * CharacterDock — 回归测试：CharacterDock 指针交互。
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DramaCharacter } from '../../src/types/dramaAssets';

const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  stateIndex: 0, refIndex: 0,
  values: [] as Array<{ get: () => number; set: (value: number) => void }>, valueIndex: 0,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useState: <T,>(initial: T) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: T) => { harness.states[index] = value; }];
  },
  useRef: <T,>(initial: T) => harness.refs[harness.refIndex++] ??= { current: initial },
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('framer-motion', () => ({
  motion: { div: 'div', button: 'button' }, useReducedMotion: () => false,
  useMotionValue: (initial: number) => {
    const index = harness.valueIndex++;
    let value = initial;
    return harness.values[index] ??= { get: () => value, set: (next: number) => { value = next; } };
  },
  animate: (value: { set: (value: number) => void }, target: number) => { value.set(target); return Promise.resolve(); },
}));
vi.mock('../../src/i18n', () => ({ useT: () => (text: string) => text }));

import CharacterDock from '../../src/components/character/CharacterDock';

type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

beforeEach(() => {
  harness.states = []; harness.refs = []; harness.values = [];
  vi.stubGlobal('document', { body: {} });
});

function setup() {
  const characters = ['a', 'b', 'c'].map((id) => ({ id, name: id })) as DramaCharacter[];
  const onSelect = vi.fn();
  const onReorder = vi.fn(async (_ids: string[]) => true);
  const buttons = characters.map((character, index) => ({
    offsetLeft: index * 75, offsetWidth: 68, offsetTop: 10,
    dataset: { characterId: character.id },
    getBoundingClientRect: () => ({ left: index * 75, top: 10, width: 68, height: 94 }),
  }));
  const list = {
    scrollLeft: 0, scrollTop: 0, clientWidth: 225,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 225, width: 225 }),
    querySelectorAll: () => buttons,
    setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  };
  let tree: Element[] = [];
  function render() {
    harness.stateIndex = harness.refIndex = harness.valueIndex = 0;
    tree = elements(CharacterDock({ characters, selectedId: 'b', renderAvatar: () => null, onSelect, onReorder }));
    harness.refs[0].current = list;
  }
  function fire(id: string | null, handler: string, extra: Record<string, unknown> = {}) {
    const element = tree.find((item) => id ? item.props['data-character-id'] === id : item.props.role === 'group')!;
    return (element.props[handler] as (event: unknown) => unknown)({
      button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 40,
      currentTarget: id ? buttons.find((button) => button.dataset.characterId === id) : list,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
    });
  }
  render();
  return { list, buttons, render, fire, onSelect, onReorder };
}

describe('CharacterDock 指针交互', () => {
  it('轻点只选择，不提交排序；指针由固定容器捕获', async () => {
    const view = setup();
    view.fire('b', 'onPointerDown');
    expect(view.list.setPointerCapture).toHaveBeenCalledWith(1);
    view.fire(null, 'onPointerMove', { clientX: 103 });
    await view.fire(null, 'onPointerUp');
    expect(view.onSelect).toHaveBeenCalledWith('b');
    expect(view.onReorder).not.toHaveBeenCalled();
  });
  it('跨位拖动只保存一次，不切换当前角色，并屏蔽尾随点击', async () => {
    const view = setup();
    view.fire('b', 'onPointerDown');
    view.fire(null, 'onPointerMove', { clientX: 180 });
    view.render();
    view.buttons[1].offsetLeft = 150;
    await view.fire(null, 'onPointerUp');
    await vi.waitFor(() => expect(view.onReorder).toHaveBeenCalledExactlyOnceWith(['a', 'c', 'b']));
    expect(view.onSelect).not.toHaveBeenCalled();
    const stopPropagation = vi.fn();
    view.fire(null, 'onClickCapture', { detail: 1, stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    view.render();
    view.fire('a', 'onPointerDown', { clientX: 20 });
    await view.fire(null, 'onPointerUp');
    expect(view.onSelect).toHaveBeenCalledWith('a');
  });
  it('pointercancel 取消预览不保存，后续拖拽仍可执行', async () => {
    const view = setup();
    view.fire('b', 'onPointerDown');
    view.fire(null, 'onPointerMove', { clientX: 180 });
    view.fire(null, 'onPointerCancel');
    view.render();
    await view.fire(null, 'onPointerUp');
    expect(view.onReorder).not.toHaveBeenCalled();
    expect(view.list.releasePointerCapture).toHaveBeenCalledWith(1);
    view.fire('b', 'onPointerDown');
    await view.fire(null, 'onPointerUp');
    expect(view.onSelect).toHaveBeenCalledWith('b');
  });
  it('第二根手指不接管当前拖拽，非主按钮不启动', async () => {
    const view = setup();
    view.fire('b', 'onPointerDown', { button: 2 });
    expect(view.list.setPointerCapture).not.toHaveBeenCalled();
    view.fire('b', 'onPointerDown');
    view.fire(null, 'onPointerMove', { pointerId: 2, clientX: 180 });
    view.fire(null, 'onPointerCancel', { pointerId: 2 });
    await view.fire(null, 'onPointerUp');
    expect(view.onReorder).not.toHaveBeenCalled();
    expect(view.onSelect).toHaveBeenCalledWith('b');
  });
});

/**
 * useCanvasSecondaryClickMenu — 回归测试：分组右键命中。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const driver = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useEffect: (effect: () => () => void) => { driver.cleanup = effect(); },
}));

import { useCanvasSecondaryClickMenu } from '../../src/hooks/useCanvasSecondaryClickMenu';

afterEach(() => {
  driver.cleanup?.();
  vi.unstubAllGlobals();
});

function SecondaryClickProbe(expanded = true) {
  const pane = { closest: (selector: string) => selector === '.react-flow__pane' ? pane : null };
  const title = { getBoundingClientRect: () => ({ left: 10, right: 800, top: 10, bottom: 38 }) };
  const group = {
    getAttribute: () => 'group',
    querySelector: (selector: string) => !expanded ? null : selector === '.canvas-group-title' ? title : {},
    getBoundingClientRect: () => ({ left: 10, right: 800, top: 10, bottom: 600 }),
  };
  const doc = Object.assign(new EventTarget(), {
    elementFromPoint: vi.fn(() => pane), querySelectorAll: vi.fn(() => [group]),
  });
  vi.stubGlobal('document', doc);
  const openNodeMenu = vi.fn();
  const openCanvasMenu = vi.fn();
  useCanvasSecondaryClickMenu({ interactionModeRef: { current: 'default' }, openNodeMenu, openCanvasMenu });
  const rightClick = (x: number, y: number) => {
    for (const type of ['pointerdown', 'pointerup']) {
      doc.dispatchEvent(Object.assign(new Event(type), { button: 2, clientX: x, clientY: y }));
    }
  };
  return { doc, group, openNodeMenu, openCanvasMenu, rightClick };
}

describe('分组右键命中', () => {
  it.each(['.prompt-editor .prompt-chip', '.mention-dropdown'])('引用胶囊及其菜单的右键交给编辑器：%s', (match) => {
    const test = SecondaryClickProbe();
    test.doc.elementFromPoint.mockReturnValue({
      closest: (selector: string) => selector.split(', ').includes(match) ? {} : null,
    } as never);
    test.rightClick(500, 300);
    expect(test.openNodeMenu).not.toHaveBeenCalled();
    expect(test.openCanvasMenu).not.toHaveBeenCalled();
    const contextmenu = new Event('contextmenu', { cancelable: true });
    test.doc.dispatchEvent(contextmenu);
    expect(contextmenu.defaultPrevented).toBe(false);
  });

  it('选中展开分组后，内部空白处仍打开画布新建菜单', () => {
    const test = SecondaryClickProbe();
    test.rightClick(500, 300);
    expect(test.openCanvasMenu).toHaveBeenCalledOnce();
    expect(test.openNodeMenu).not.toHaveBeenCalled();
  });

  it('标题栏仍可通过选区几何回查打开分组菜单', () => {
    const test = SecondaryClickProbe();
    test.rightClick(500, 20);
    expect(test.openNodeMenu).toHaveBeenCalledWith(expect.anything(), { id: 'group' });
    expect(test.openCanvasMenu).not.toHaveBeenCalled();
  });

  it('折叠文件夹保留整个卡片的右键命中', () => {
    const test = SecondaryClickProbe(false);
    test.rightClick(500, 300);
    expect(test.openNodeMenu).toHaveBeenCalledWith(expect.anything(), { id: 'group' });
    expect(test.openCanvasMenu).not.toHaveBeenCalled();
  });

  it('组内真实节点优先于选中的分组', () => {
    const test = SecondaryClickProbe();
    test.doc.elementFromPoint.mockReturnValue({
      closest: (selector: string) => selector === '.react-flow__node' ? { getAttribute: () => 'child' } : null,
    } as never);
    test.rightClick(500, 300);
    expect(test.openNodeMenu).toHaveBeenCalledWith(expect.anything(), { id: 'child' });
    expect(test.openCanvasMenu).not.toHaveBeenCalled();
  });
});

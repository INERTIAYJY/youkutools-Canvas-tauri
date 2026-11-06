/**
 * markdownEditor — 回归测试：MarkdownEditor 查找输入法边界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { MarkdownSourceEditor } from '../../src/components/shared/MarkdownEditor';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], stateIndex: 0,
  refs: [] as Array<{ current: unknown }>, refIndex: 0,
}));
vi.mock('../../src/i18n', async (original) => {
  const actual = await original<typeof import('../../src/i18n')>();
  return { ...actual, useT: () => actual.t };
});
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <T,>(initial: T) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: T | ((old: T) => T)) => {
      hooks.states[index] = typeof value === 'function' ? (value as (old: T) => T)(hooks.states[index] as T) : value;
    }];
  },
  useRef: <T,>(initial: T) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useEffect: () => {},
  useDeferredValue: <T,>(value: T) => value,
  useMemo: <T,>(factory: () => T) => factory(),
}));
import MarkdownEditor from '../../src/components/shared/MarkdownEditor';

interface ElementLike { type: unknown; props: Record<string, unknown> & { children?: unknown; ref?: { current: unknown } } }
function elements(node: unknown): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ElementLike;
  return [element, ...elements(element.props.children)];
}
let tree: ElementLike[];
let frames: FrameRequestCallback[];
const source = { selectionEnd: 0, focus: vi.fn(), setSelectionRange: vi.fn() };
const search = { focus: vi.fn() };
function render() {
  hooks.stateIndex = hooks.refIndex = 0;
  tree = elements(MarkdownEditor({ value: '前文中文后文', onChange: vi.fn(), markdown: false, initialMode: 'source' }));
  tree.forEach((node) => { if (node.props.ref) node.props.ref.current = node.type === 'textarea' ? source : search; });
}
function control(label: string) { return tree.find((node) => node.props['aria-label'] === label)!; }
function invoke(node: ElementLike, handler: string, event?: unknown) { (node.props[handler] as (event?: unknown) => void)(event); }
function flushFrames() { frames.splice(0).forEach((frame) => frame(0)); }
function enter(isComposing = false, keyCode = 13) {
  return { key: 'Enter', nativeEvent: { isComposing, keyCode }, preventDefault: vi.fn() };
}
beforeEach(() => {
  hooks.states = []; hooks.refs = []; frames = [];
  source.focus.mockClear(); source.setSelectionRange.mockClear(); search.focus.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  render();
  invoke(tree.find((node) => node.type === 'button' && node.props['aria-expanded'] === false)!, 'onClick');
  render(); flushFrames();
  invoke(control('查找内容'), 'onChange', { target: { value: '中文' } }); render();
});
afterEach(() => vi.unstubAllGlobals());

describe('MarkdownEditor 查找输入法边界', () => {
  it.each([[true, 13], [false, 229]])('输入法确认 isComposing=%s / keyCode=%i 不执行查找或抢焦点', (isComposing, keyCode) => {
    const event = enter(isComposing, keyCode);
    invoke(control('查找内容'), 'onKeyDown', event); render(); flushFrames();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(source.focus).not.toHaveBeenCalled(); expect(source.setSelectionRange).not.toHaveBeenCalled();
    expect(tree.some((node) => node.props.children === '已定位匹配内容')).toBe(false);
  });
  it('输入完成后的 Enter 查找并选中真实匹配内容', () => {
    const event = enter();
    invoke(control('查找内容'), 'onKeyDown', event); render(); flushFrames();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(source.focus).toHaveBeenCalledOnce(); expect(source.setSelectionRange).toHaveBeenCalledWith(2, 4);
    expect(tree.some((node) => node.props.children === '已定位匹配内容')).toBe(true);
  });
});

function customSource(readOnly = false) {
  hooks.states = []; hooks.refs = []; frames = [];
  let value = '前文 @{image-id:参考图} 后文';
  let tree: ElementLike[] = [];
  const target = {};
  const textInput = { selectionStart: value.indexOf('@{'), selectionEnd: value.indexOf(' 后文'), focus: vi.fn(), setSelectionRange: vi.fn() };
  const onChange = vi.fn((next: string) => { value = next; });
  const sourceEditor: MarkdownSourceEditor = {
    getInput: () => textInput,
    render: (props) => createElement('test-source', props),
  };
  function render() {
    hooks.stateIndex = hooks.refIndex = 0;
    tree = elements(MarkdownEditor({ value, onChange, sourceEditor, readOnly, initialMode: 'source' }));
    tree.forEach((node) => {
      if (node.props.ref && node.props.className === 'ui-markdown-editor__source') node.props.ref.current = { contains: (item: unknown) => item === target };
      if (node.props.ref && node.type === 'input') node.props.ref.current = search;
    });
  }
  render();
  return { render, textInput, onChange, target, value: () => value,
    source: () => tree.find((node) => node.type === 'test-source')!,
    root: () => tree.find((node) => node.props.className === 'ui-markdown-editor nodrag nowheel')!,
    control: (label: string) => tree.find((node) => node.props['aria-label'] === label)!,
    openFind: () => invoke(tree.find((node) => node.type === 'button' && node.props['aria-expanded'] === false)!, 'onClick'),
  };
}

describe('MarkdownEditor 可选引用正文', () => {
  it('格式工具沿用原始选区，包围完整引用令牌并恢复光标', () => {
    const view = customSource();
    const { selectionStart: start, selectionEnd: end } = view.textInput;
    invoke(view.control('粗体（Ctrl+B）'), 'onClick');
    view.render(); flushFrames();
    expect(view.value()).toBe('前文 **@{image-id:参考图}** 后文');
    expect(view.textInput.focus).toHaveBeenCalledOnce();
    expect(view.textInput.setSelectionRange).toHaveBeenCalledWith(start + 2, end + 2);
  });

  it('引用插入后的正文沿用同一套工具栏撤销和重做', () => {
    const view = customSource();
    const original = view.value();
    invoke(view.source(), 'onChange', `${original} @drama{character:人物}`);
    view.render();
    invoke(view.control('撤销'), 'onClick'); view.render();
    expect(view.value()).toBe(original);
    invoke(view.control('重做'), 'onClick'); view.render();
    expect(view.value()).toBe(`${original} @drama{character:人物}`);
  });

  it('查找使用引用之后的原文偏移，正文适配器保持可编辑', () => {
    const view = customSource();
    const start = view.value().indexOf('后文');
    view.openFind(); view.render(); flushFrames();
    invoke(view.control('查找内容'), 'onChange', { target: { value: '后文' } }); view.render();
    const input = view.control('查找内容');
    invoke(input, 'onKeyDown', enter()); view.render(); flushFrames();
    expect(view.textInput.setSelectionRange).toHaveBeenCalledWith(start, start + 2);
    expect(view.source().props.readOnly).toBe(false);
  });

  it('捕获引用编辑器的格式快捷键，避免被其内部历史重复处理', () => {
    const view = customSource();
    const event = { key: 'b', ctrlKey: true, target: view.target, nativeEvent: { isComposing: false },
      preventDefault: vi.fn(), stopPropagation: vi.fn() };
    invoke(view.root(), 'onKeyDownCapture', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(view.value()).toBe('前文 **@{image-id:参考图}** 后文');
  });

  it('只读适配器拒绝正文变更，不改变原查看器的权限边界', () => {
    const view = customSource(true);
    invoke(view.source(), 'onChange', '不可写');
    expect(view.source().props.readOnly).toBe(true);
    expect(view.onChange).not.toHaveBeenCalled();
    expect(view.control('粗体（Ctrl+B）').props.disabled).toBe(true);
  });
});

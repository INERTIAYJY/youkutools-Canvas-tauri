/**
 * shotlistFieldEditor — 回归测试：分镜字段全屏编辑。
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseNodeData } from '../../src/types';
import type { MarkdownEditorProps, MarkdownSourceEditor } from '../../src/components/shared/MarkdownEditor';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], stateIndex: 0, refs: [] as Array<{ current: unknown }>, refIndex: 0,
  effects: [] as Array<() => void | (() => void)>, store: {} as unknown,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useMemo: <T,>(calculate: () => T) => calculate(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: <T,>(initial: T) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useState: <T,>(initial: T) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: T) => { hooks.states[index] = value; }];
  },
}));
vi.mock('../../src/i18n', () => ({ useT: () => (text: string) => text }));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(hooks.store), { getState: () => hooks.store }),
}));
vi.mock('../../src/components/shared/ModalOverlay', () => ({ default: 'modal-overlay' }));
vi.mock('../../src/components/shared/MarkdownEditor', () => ({ default: 'markdown-editor' }));
vi.mock('../../src/components/shared/ReferencePreviewBody', () => ({ default: 'reference-preview-body' }));
vi.mock('../../src/components/nodes/shared/MentionEditor', () => ({ default: 'mention-editor' }));

import ShotlistFieldEditor from '../../src/components/nodes/ShotlistFieldEditor';

type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

beforeEach(() => { hooks.states = []; hooks.refs = []; hooks.effects = []; });

function setup(field: 'content' | 'dialogue' = 'content') {
  const node = { id: 'table', data: {
    type: 'ai-shotlist', label: '第一场', displayId: 12, shotlistRows: [
      { id: 'first', shotNo: '1', content: '第一镜内容', dialogue: '第一句', duration: 3 },
      { id: 'second', shotNo: '2', content: '第二镜内容', dialogue: '第二句', duration: 4,
        frame: { nodeId: 'image', kind: 'image', url: 'image-url' } },
    ],
  } as BaseNodeData };
  const state = {
    currentProjectId: 'project-a', projectLoadStatus: 'ready', nodes: [node], isCreatingProject: false, isReturningToStartPage: false, switchingProjectName: null as string | null,
    commitToHistory: vi.fn(),
    updateNodeDataTransient: vi.fn((id: string, patch: Partial<BaseNodeData>) => {
      const target = state.nodes.find((item) => item.id === id);
      if (target) target.data = { ...target.data, ...patch };
    }),
  };
  hooks.store = state;
  const onClose = vi.fn();
  let tree: Element[] = [];
  function render() {
    hooks.stateIndex = hooks.refIndex = 0;
    tree = elements(ShotlistFieldEditor({ nodeId: 'table', rowId: 'second', field, projectId: 'project-a', onClose }));
  }
  render();
  const cleanup = hooks.effects.splice(0).map((effect) => effect());
  const editor = () => tree.find((item) => item.type === 'markdown-editor')!.props as unknown as MarkdownEditorProps;
  const close = () => (tree.find((item) => item.type === 'modal-overlay')!.props.onClose as () => void)();
  return { state, node, render, editor, close, onClose, unmount: () => cleanup.forEach((dispose) => { if (typeof dispose === 'function') dispose(); }) };
}

describe('分镜字段全屏编辑', () => {
  it.each(['content', 'dialogue'] as const)('按稳定行 ID 更新 %s，保留重排及其他字段，关闭时提交历史', (field) => {
    const view = setup(field);
    const first = view.node.data.shotlistRows![0];
    const second = view.node.data.shotlistRows![1];
    view.node.data.shotlistRows = [second, { ...first, content: '其他编辑已更新' }];
    const value = '正文 @drama{character-1:人物} 与 @{image-id:参考图}';
    view.editor().onChange(value);
    view.render();
    expect(view.editor().value).toBe(value);
    expect(view.editor().readOnly).toBe(false);
    expect(view.node.data.shotlistRows).toEqual([
      { ...second, [field]: value }, { ...first, content: '其他编辑已更新' },
    ]);
    expect(view.state.commitToHistory).toHaveBeenCalledOnce();
    view.close();
    view.unmount();
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.state.commitToHistory).toHaveBeenCalledTimes(2);
  });

  it.each(['project', 'loading-project', 'switching-project', 'deleted-row', 'external-edit', 'generating'])('%s 变化后拒绝旧回写', (change) => {
    const view = setup();
    if (change === 'project') view.state.currentProjectId = 'project-b';
    if (change === 'loading-project') view.state.projectLoadStatus = 'loading';
    if (change === 'switching-project') view.state.switchingProjectName = '另一个项目';
    if (change === 'deleted-row') view.node.data.shotlistRows = view.node.data.shotlistRows!.slice(0, 1);
    if (change === 'external-edit') view.node.data.shotlistRows![1].content = '后台已更新';
    if (change === 'generating') view.node.data.status = 'loading';
    view.editor().onChange('旧编辑不得覆盖');
    view.render();
    expect(view.state.updateNodeDataTransient).not.toHaveBeenCalled();
    expect(view.editor().readOnly).toBe(true);
    expect(view.state.commitToHistory).not.toHaveBeenCalled();
  });

  it('关闭后，即使项目仍相同，旧输入回调也不能再次写入', () => {
    const view = setup();
    const previousChange = view.editor().onChange;
    view.close();
    previousChange('迟到的旧输入');
    expect(view.state.updateNodeDataTransient).not.toHaveBeenCalled();
    expect(view.state.commitToHistory).not.toHaveBeenCalled();
  });

  it('Escape 优先收起引用菜单，再次关闭才退出字段编辑', () => {
    const view = setup();
    const source = view.editor().sourceEditor!;
    const element = source.render({ value: '原文', onChange: vi.fn(), readOnly: false, label: '内容' }) as Element;
    const dismissMenu = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    (element.props.ref as { current: unknown }).current = { dismissMenu };
    view.close();
    expect(view.onClose).not.toHaveBeenCalled();
    view.editor().onChange('收起后继续编辑');
    expect(view.state.updateNodeDataTransient).toHaveBeenCalledOnce();
    view.close();
    expect(dismissMenu).toHaveBeenCalledTimes(2);
    expect(view.onClose).toHaveBeenCalledOnce();
  });

  it('正文适配器复用 MentionEditor 和原始文本选区，预览沿用共用胶囊渲染', () => {
    const view = setup('dialogue');
    const props = view.editor();
    expect(props).toMatchObject({ initialMode: 'source', label: '台词', readOnly: false });
    const source = props.sourceEditor as MarkdownSourceEditor;
    const onChange = vi.fn();
    const element = source.render({ value: '原文', onChange, readOnly: false, label: '台词' }) as Element;
    expect(element.type).toBe('mention-editor');
    expect(element.props).toMatchObject({ nodeId: 'table', value: '原文', onChange, portalDropdown: true, disabled: false, canSubmit: false });
    const textInput = { selectionStart: 1, selectionEnd: 2, focus: vi.fn(), setSelectionRange: vi.fn() };
    (element.props.ref as { current: unknown }).current = { textInput };
    expect(source.getInput()).toBe(textInput);
    const preview = props.renderPreview!('正文 @{image-id:参考}', true) as Element;
    expect(preview.type).toBe('reference-preview-body');
    expect(preview.props).toMatchObject({ value: '正文 @{image-id:参考}', markdown: true });
  });
});

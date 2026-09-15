import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ElementLike {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

const addCustomStyle = vi.fn().mockResolvedValue(undefined);
const updateCustomStyle = vi.fn().mockResolvedValue(undefined);
const deleteCustomStyle = vi.fn().mockResolvedValue(undefined);
const customStyle = {
  id: 'custom-watercolor',
  nodeType: 'ai-image',
  name: '自定义水彩',
  prompt: '柔和水彩纸纹理',
  thumbnail: 'data:image/png;base64,fixture',
  createdAt: 1,
};
const store = {
  customStyles: [customStyle],
  addCustomStyle,
  updateCustomStyle,
  deleteCustomStyle,
  projects: [],
  currentProjectId: null,
};

const stateSlots: unknown[] = [];
let stateCursor = 0;

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T | (() => T)) => {
    const index = stateCursor++;
    if (!(index in stateSlots)) {
      stateSlots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    return [stateSlots[index], (next: T | ((previous: T) => T)) => {
      stateSlots[index] = typeof next === 'function'
        ? (next as (previous: T) => T)(stateSlots[index] as T)
        : next;
    }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('zustand/react/shallow', () => ({ useShallow: <T,>(selector: T) => selector }));
vi.mock('../../src/i18n', () => ({
  useT: () => (text: string, vars?: Record<string, string | number>) => (
    text.replace(/\{(\w+)\}/g, (match, key: string) => String(vars?.[key] ?? match))
  ),
}));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: <T,>(selector: (state: typeof store) => T) => selector(store),
}));
vi.mock('../../src/components/shared/ModalOverlay', () => ({
  default: ({ children, ariaLabel }: { children: unknown; ariaLabel: string }) => ({
    type: 'section',
    props: { 'aria-label': ariaLabel, children },
  }),
}));
vi.mock('../../src/components/shared/PopupCloseButton', () => ({ default: () => null }));

function isElement(value: unknown): value is ElementLike {
  return Boolean(value && typeof value === 'object' && 'props' in value);
}

function findElement(root: unknown, predicate: (element: ElementLike) => boolean): ElementLike | undefined {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!isElement(root)) return undefined;
  return predicate(root) ? root : findElement(root.props.children, predicate);
}

function findElements(root: unknown, predicate: (element: ElementLike) => boolean): ElementLike[] {
  if (Array.isArray(root)) return root.flatMap((child) => findElements(child, predicate));
  if (!isElement(root)) return [];
  return [
    ...(predicate(root) ? [root] : []),
    ...findElements(root.props.children, predicate),
  ];
}

describe('StyleSelector', () => {
  let StyleSelector: (props: {
    nodeType: string;
    selectedStyle?: string;
    onChange?: (styleId: string) => void;
  }) => ReactElement;

  const render = (props: Parameters<typeof StyleSelector>[0] = { nodeType: 'ai-image' }) => {
    stateCursor = 0;
    return StyleSelector(props);
  };
  const click = (element: ElementLike) => {
    (element.props.onClick as (event: { stopPropagation: () => void; preventDefault: () => void }) => void)({
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    });
  };

  beforeEach(async () => {
    stateSlots.length = 0;
    stateCursor = 0;
    vi.clearAllMocks();
    vi.stubGlobal('document', { body: {} });
    ({ default: StyleSelector } = await import('../../src/components/nodes/shared/StyleSelector'));
  });

  it('只给自定义画风显示独立的编辑和删除按钮', () => {
    const tree = render();
    const edit = findElement(tree, (element) => element.props['aria-label'] === '编辑 自定义水彩');
    const deletes = findElements(tree, (element) => element.props['aria-label'] === '删除此画风');
    const customCard = findElement(tree, (element) => element.props.className === 'style-card is-custom');

    expect(edit).toBeDefined();
    expect(deletes).toHaveLength(1);
    expect(customCard?.type).toBe('div');
    expect(findElements(customCard, (element) => element.type === 'button')).toHaveLength(3);
  });

  it('编辑时回填现有内容并通过 updateCustomStyle 保存', () => {
    click(findElement(render(), (element) => element.props['aria-label'] === '编辑 自定义水彩')!);
    let tree = render();
    expect(findElement(tree, (element) => element.props['aria-label'] === '编辑 自定义水彩')).toBeDefined();
    expect(findElement(tree, (element) => element.props.value === '自定义水彩')).toBeDefined();
    expect(findElement(tree, (element) => element.props.value === '柔和水彩纸纹理')).toBeDefined();

    const nameInput = findElement(tree, (element) => element.props.value === '自定义水彩')!;
    (nameInput.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '新水彩' } });
    tree = render();
    click(findElement(tree, (element) => element.props.className === 'style-add-submit')!);

    expect(updateCustomStyle).toHaveBeenCalledWith('custom-watercolor', {
      nodeType: 'ai-image',
      name: '新水彩',
      prompt: '柔和水彩纸纹理',
      thumbnail: 'data:image/png;base64,fixture',
    });
    expect(addCustomStyle).not.toHaveBeenCalled();
  });

  it('删除当前选中画风时持久化删除并清空选择', () => {
    const onChange = vi.fn();
    const tree = render({ nodeType: 'ai-image', selectedStyle: customStyle.id, onChange });
    click(findElement(tree, (element) => element.props['aria-label'] === '删除此画风')!);

    expect(deleteCustomStyle).toHaveBeenCalledWith(customStyle.id);
    expect(onChange).toHaveBeenCalledWith('');
  });
});

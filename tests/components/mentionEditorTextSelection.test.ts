/**
 * mentionEditorTextSelection — 回归用例：引用编辑器的原文选区；胶囊显示名与令牌长度不同时，后续文字仍按原文定位，保留换行并忽略落点；选中令牌内部时扩到完整胶囊，格式工具不会按显示文字切断身份。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMentionTextSelection, selectMentionText } from '../../src/components/nodes/shared/mentionEditorTextSelection';
import { serializeDOM, ZWSP } from '../../src/components/nodes/shared/mentionEditorDom';

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument = doc;
  focus = vi.fn();
  nodeType: number;
  tagName: string;
  private text: string;
  attrs: Record<string, string>;
  constructor(nodeType: number, tagName = '', text = '', attrs: Record<string, string> = {}) {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.text = text;
    this.attrs = attrs;
  }
  get textContent(): string { return this.nodeType === 3 ? this.text : this.childNodes.map((node) => node.textContent).join(''); }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  appendChild(node: TestNode) { this.childNodes.push(node); node.parentNode = this; return node; }
  contains(node: unknown): boolean { return this === node || this.childNodes.some((child) => child.contains(node)); }
  cloneNode(deep: boolean): TestNode {
    const copy = new TestNode(this.nodeType, this.tagName, this.text, { ...this.attrs });
    if (deep) this.childNodes.forEach((child) => copy.appendChild(child.cloneNode(true)));
    return copy;
  }
  querySelector(selector: string): TestNode | null {
    for (const child of this.childNodes) {
      if ((child.attrs.class || '').split(' ').includes(selector.slice(1))) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}
class TestRange {
  startContainer!: TestNode;
  endContainer!: TestNode;
  startOffset = 0;
  endOffset = 0;
  setStart(node: TestNode, offset: number) { this.startContainer = node; this.startOffset = offset; }
  setEnd(node: TestNode, offset: number) { this.endContainer = node; this.endOffset = offset; }
}
let currentRange: TestRange | null;
const selection = {
  get rangeCount() { return currentRange ? 1 : 0; },
  getRangeAt: (_index: number) => currentRange!,
  removeAllRanges: () => { currentRange = null; },
  addRange: (range: TestRange) => { currentRange = range; },
};
interface TestDocument {
  createElement: (tag: string) => TestNode;
  createTextNode: (text: string) => TestNode;
  getSelection: () => typeof selection;
  createRange: () => TestRange;
}
const doc: TestDocument = {
  createElement: (tag) => new TestNode(1, tag.toUpperCase()),
  createTextNode: (text) => new TestNode(3, '', text),
  getSelection: () => selection,
  createRange: () => new TestRange(),
};
const html = (node: TestNode) => node as unknown as HTMLElement;
const text = (value: string) => doc.createTextNode(value);
function selected(node: TestNode, start: number, end = start) {
  const range = new TestRange(); range.setStart(node, start); range.setEnd(node, end); currentRange = range;
}
function chip(id: string, label: string) {
  const node = new TestNode(1, 'SPAN', '', { 'data-ref-id': id, 'data-ref-label': label });
  node.appendChild(text(label));
  return node;
}

beforeEach(() => { currentRange = null; vi.stubGlobal('Node', { TEXT_NODE: 3, ELEMENT_NODE: 1 }); });
afterEach(() => vi.unstubAllGlobals());

describe('引用编辑器的原文选区', () => {
  it('胶囊显示名与令牌长度不同时，后续文字仍按原文定位，保留换行并忽略落点', () => {
    const root = doc.createElement('div');
    root.appendChild(text(`前${ZWSP}`));
    root.appendChild(chip('image-long-id', '参考'));
    root.appendChild(doc.createElement('br'));
    const tail = root.appendChild(text('甲乙'));
    const start = '前@{image-long-id:参考}\n'.length;
    selected(tail, 0, 2);
    expect(readMentionTextSelection(html(root))).toEqual({ start, end: start + 2 });
    selectMentionText(html(root), start, start + 2);
    expect(readMentionTextSelection(html(root))).toEqual({ start, end: start + 2 });
  });

  it('选中令牌内部时扩到完整胶囊，格式工具不会按显示文字切断身份', () => {
    const root = doc.createElement('div');
    root.appendChild(text('甲'));
    root.appendChild(chip('image-id', '图'));
    root.appendChild(text('乙'));
    const end = '甲@{image-id:图}'.length;
    selectMentionText(html(root), 4, end - 2);
    expect(readMentionTextSelection(html(root))).toEqual({ start: 1, end });
    expect(serializeDOM(html(root))).toBe('甲@{image-id:图}乙');
  });

  it('工作流值区的换行和内层引用使用原始参数文本的偏移', () => {
    const root = doc.createElement('div');
    const workflow = root.appendChild(new TestNode(1, 'SPAN', '', {
      'data-wf-id': '42', 'data-wf-title': '提示词', 'data-wf-type': 'prompt',
    }));
    workflow.appendChild(text('展示标题不计入参数'));
    const value = workflow.appendChild(new TestNode(1, 'SPAN', '', { class: 'prompt-chip-wf-value' }));
    value.appendChild(text('甲'));
    value.appendChild(doc.createElement('br'));
    value.appendChild(chip('image-id', '图'));
    const tail = value.appendChild(text('乙'));
    const source = serializeDOM(html(root));
    const start = source.indexOf('乙');
    selected(tail, 0, 1);
    expect(readMentionTextSelection(html(root))).toEqual({ start, end: start + 1 });
    selectMentionText(html(root), start, start + 1);
    expect(readMentionTextSelection(html(root))).toEqual({ start, end: start + 1 });
  });

  it('支持空正文和 UTF-16 字符偏移，不借用另一个编辑器的选区', () => {
    const root = doc.createElement('div');
    selectMentionText(html(root), 0, 20);
    expect(readMentionTextSelection(html(root))).toEqual({ start: 0, end: 0 });
    const content = root.appendChild(text(`甲${ZWSP}😀乙`));
    selected(content, 4, 5);
    expect(readMentionTextSelection(html(root))).toEqual({ start: 3, end: 4 });
    selected(text('外部输入'), 1);
    expect(readMentionTextSelection(html(root))).toBeNull();
  });
});

/**
 * mentionEditorTextSelection — 读取并设置引用编辑器的纯文本选区。
 */
import { isChipEl, serializeDOM, ZWSP } from './mentionEditorDom';

interface DomPoint { node: Node; offset: number }
interface SourceSpan { start: number; end: number; before: DomPoint; after: DomPoint; text?: Text }
interface SourceBounds { start: number; end: number; children?: number[] }

/** 只读取现有 DOM；胶囊展示名的长度不等于原始引用令牌的长度。 */
function sourceMap(root: HTMLElement) {
  const spans: SourceSpan[] = [];
  const bounds = new Map<Node, SourceBounds>();
  let position = 0;
  const serialized = (node: Node) => {
    const wrapper = root.ownerDocument.createElement('div');
    wrapper.appendChild(node.cloneNode(true));
    // 尾部哨兵保留换行，不把光标所在行首误算到上一行。
    wrapper.appendChild(root.ownerDocument.createTextNode('x'));
    return serializeDOM(wrapper).slice(0, -1);
  };
  const atomic = (length: number, before: DomPoint, after: DomPoint) => {
    spans.push({ start: position, end: position + length, before, after });
    position += length;
  };
  const walkChildren = (node: Node) => {
    const start = position;
    const children = [position];
    for (const child of Array.from(node.childNodes)) { walk(child); children.push(position); }
    bounds.set(node, { start, end: position, children });
  };
  const walk = (node: Node) => {
    const start = position;
    if (node.nodeType === Node.TEXT_NODE) {
      position += (node.textContent || '').split(ZWSP).join('').length;
      spans.push({ start, end: position, before: { node, offset: 0 },
        after: { node, offset: node.textContent?.length ?? 0 }, text: node as Text });
      bounds.set(node, { start, end: position });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { bounds.set(node, { start, end: position }); return; }
    const element = node as HTMLElement;
    if (isChipEl(node) || element.tagName === 'BR') {
      const parent = node.parentNode!;
      const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
      const before = { node: parent, offset: index };
      const after = { node: parent, offset: index + 1 };
      const value = element.hasAttribute('data-wf-id') ? element.querySelector<HTMLElement>('.prompt-chip-wf-value') : null;
      if (value) {
        atomic(serialized(node).length - serialized(value).length - 1, before, { node: value, offset: 0 });
        walkChildren(value);
        atomic(1, { node: value, offset: value.childNodes.length }, after);
      } else atomic(element.tagName === 'BR' ? 1 : serialized(node).length, before, after);
      bounds.set(node, { start, end: position });
      return;
    }
    walkChildren(node);
  };
  walkChildren(root);
  return { spans, bounds, length: serializeDOM(root).length };
}

export function readMentionTextSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const map = sourceMap(root);
  const offsetAt = (point: DomPoint, end: boolean) => {
    let node: Node | null = point.node;
    while (node && !map.bounds.has(node)) node = node.parentNode;
    const entry = node && map.bounds.get(node);
    if (!node || !entry) return map.length;
    if (node === point.node && node.nodeType === Node.TEXT_NODE) {
      return Math.min(map.length, entry.start + (node.textContent || '').slice(0, point.offset).split(ZWSP).join('').length);
    }
    return Math.min(map.length, node === point.node && entry.children
      ? entry.children[Math.min(point.offset, entry.children.length - 1)] : end ? entry.end : entry.start);
  };
  return { start: offsetAt({ node: range.startContainer, offset: range.startOffset }, false),
    end: offsetAt({ node: range.endContainer, offset: range.endOffset }, true) };
}

/** 源码工具栏按原文偏移选区；命中令牌内部时扩到完整胶囊，不切碎引用。 */
export function selectMentionText(root: HTMLElement, start: number, end: number): void {
  root.focus({ preventScroll: true });
  const map = sourceMap(root);
  const from = Math.max(0, Math.min(start, end, map.length));
  const to = Math.max(from, Math.min(Math.max(start, end), map.length));
  const pointAt = (offset: number, atEnd: boolean): DomPoint => {
    const span = map.spans.find((item) => offset >= item.start && offset <= item.end);
    if (!span) return { node: root, offset: root.childNodes.length };
    if (span.text) {
      const text = span.text.textContent || '';
      let sourceOffset = span.start;
      for (let rawOffset = 0; rawOffset <= text.length; rawOffset += 1) {
        if (sourceOffset === offset) return { node: span.text, offset: rawOffset };
        if (text[rawOffset] !== ZWSP) sourceOffset += 1;
      }
    }
    return offset === span.start ? span.before : offset === span.end ? span.after : atEnd ? span.after : span.before;
  };
  const left = pointAt(from, from === to);
  const right = pointAt(to, true);
  const range = root.ownerDocument.createRange();
  range.setStart(left.node, left.offset);
  range.setEnd(right.node, right.offset);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

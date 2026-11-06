/**
 * nodeBounds — 覆盖显示尺寸优先级、未挂载估算、嵌套坐标与异常父链终止。
 */
import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';
import { createCanvasNoteData } from '../../src/types/canvasNote';
import { getNodeBounds, getNodeSize, getParentOffset } from '../../src/utils/nodeBounds';
import { getDistributionItems, getItemGap } from '../../src/utils/distributionGeometry';

function node(patch: Partial<Node<BaseNodeData>> = {}): Node<BaseNodeData> {
  return {
    id: 'node', type: 'ai-image', position: { x: 10, y: 20 },
    data: { type: 'ai-image', label: '节点' }, ...patch,
  };
}

describe('节点显示尺寸与未挂载估算', () => {
  it('实测尺寸覆盖业务估值和显式尺寸，读取不改写节点', () => {
    const subject = node({
      measured: { width: 480, height: 88 }, width: 400, height: 200,
      initialWidth: 360, initialHeight: 180, style: { width: 320, height: 160 },
      data: { type: 'ai-image', label: '节点', nodeWidth: 280, nodeHeight: 140 },
    });
    const before = structuredClone(subject);
    expect(getNodeSize(subject)).toEqual({ width: 480, height: 88 });
    expect(getNodeBounds(subject, [subject])).toMatchObject({ right: 490, bottom: 108 });
    expect(subject).toEqual(before);
  });

  it('未实测时按 React Flow 显式尺寸、初始化尺寸、像素样式、业务估值回退', () => {
    const subject = node({
      width: 500, height: 300, initialWidth: 450, initialHeight: 250,
      style: { width: '400px', height: '200px' },
      data: { type: 'ai-image', label: '节点', nodeWidth: 350, nodeHeight: 150 },
    });
    expect(getNodeSize(subject)).toEqual({ width: 500, height: 300 });
    const initial = { ...subject, width: undefined, height: undefined };
    expect(getNodeSize(initial)).toEqual({ width: 450, height: 250 });
    const styled = { ...initial, initialWidth: undefined, initialHeight: undefined };
    expect(getNodeSize(styled)).toEqual({ width: 400, height: 200 });
    expect(getNodeSize({ ...styled, style: undefined })).toEqual({ width: 350, height: 150 });
  });

  it('宽高独立回退，不能因单轴已测量而丢失另一轴的声明', () => {
    expect(getNodeSize(node({
      measured: { width: 480, height: 0 }, width: 400, height: 180,
      data: { type: 'ai-image', label: '节点', nodeWidth: 1000, nodeHeight: 1000 },
    }))).toEqual({ width: 480, height: 180 });
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('忽略无效实测值 %s，使用有效像素样式', (invalid) => {
    expect(getNodeSize(node({
      measured: { width: invalid, height: invalid }, width: invalid, height: invalid,
      initialWidth: invalid, initialHeight: invalid, style: { width: '360.5px', height: 210 },
      data: { type: 'ai-image', label: '节点', nodeWidth: 900, nodeHeight: 900 },
    }))).toEqual({ width: 360.5, height: 210 });
  });

  it.each(['100%', 'auto', '12rem', 'calc(100% - 8px)'])('不把相对样式 %s 当作画布像素', (size) => {
    expect(getNodeSize(node({
      style: { width: size, height: size },
      data: { type: 'ai-image', label: '节点', nodeWidth: 240, nodeHeight: 120 },
    }))).toEqual({ width: 240, height: 120 });
  });

  it.each([
    ['ai-text', 280, 160], ['ai-image', 280, 158], ['source-image', 280, 158],
    ['ai-video', 280, 160], ['ai-audio', 260, 140], ['source-audio', 260, 140],
    ['unknown', 280, 160],
  ] as const)('%s 缺少有效尺寸时使用类型默认', (type, width, height) => {
    expect(getNodeSize(node({ type, data: { type: 'ai-image', label: '旧节点', nodeWidth: 0, nodeHeight: NaN } })))
      .toEqual({ width, height });
  });

  it('未挂载的分组采用自身样式，音频实测高度不受创建估值影响', () => {
    expect(getNodeSize(node({ type: 'group', style: { width: 800, height: 600 } })))
      .toEqual({ width: 800, height: 600 });
    expect(getNodeSize(node({ type: 'ai-audio', measured: { width: 280, height: 88 },
      data: { type: 'ai-audio', label: '音频', nodeWidth: 260, nodeHeight: 140 } })))
      .toEqual({ width: 280, height: 88 });
  });

  it('未挂载笔记没有卡片镜像字段时仍可解析笔记自身尺寸', () => {
    const subject = node({ type: 'canvas-note', data: {
      type: 'canvas-note', label: '笔记', note: createCanvasNoteData('rectangle', { width: 420, height: 110 }),
    } });
    expect(getNodeSize(subject)).toEqual({ width: 420, height: 110 });
    expect(getNodeBounds(subject, [subject])).toMatchObject({ right: 430, bottom: 130 });
  });
});

describe.each(['数组', 'Map'] as const)('%s 父链遍历', (kind) => {
  const lookup = (nodes: Node<BaseNodeData>[]) => {
    // 查询次数设上限，循环保护回退时直接失败，避免同步死循环挂住整个测试进程。
    let remaining = nodes.length;
    const consume = () => {
      if (remaining-- <= 0) throw new Error('父链查询次数超过节点数');
    };
    if (kind === 'Map') {
      const index = new Map(nodes.map((item) => [item.id, item]));
      const get = index.get.bind(index);
      index.get = (id) => { consume(); return get(id); };
      return index;
    }
    const items = [...nodes];
    Object.defineProperty(items, 'find', {
      value: (predicate: (item: Node<BaseNodeData>) => boolean) => {
        consume();
        return nodes.find(predicate);
      },
    });
    return items;
  };

  it('没有父级或父级缺失时使用零偏移', () => {
    const root = node();
    const orphan = node({ parentId: 'missing' });
    expect(getParentOffset(root, lookup([root]))).toEqual({ x: 0, y: 0 });
    expect(getParentOffset(orphan, lookup([orphan]))).toEqual({ x: 0, y: 0 });
    expect(getNodeBounds(orphan, lookup([orphan]))).toMatchObject({ x: 10, y: 20 });
  });

  it('自引用不重复累加自身坐标，也不改写原父链', () => {
    const subject = node({ parentId: 'node' });
    const before = structuredClone(subject);
    expect(getParentOffset(subject, lookup([subject]))).toEqual({ x: 0, y: 0 });
    expect(getNodeBounds(subject, lookup([subject]))).toMatchObject({ x: 10, y: 20 });
    expect(subject).toEqual(before);
  });

  it('两节点循环在回到当前节点前停止，每个祖先至多计入一次', () => {
    const first = node({ id: 'a', parentId: 'b' });
    const second = node({ id: 'b', parentId: 'a', position: { x: 100, y: 200 } });
    const nodes = [first, second];
    const before = structuredClone(nodes);
    expect(getParentOffset(first, lookup(nodes))).toEqual({ x: 100, y: 200 });
    expect(getParentOffset(second, lookup(nodes))).toEqual({ x: 10, y: 20 });
    expect(getNodeBounds(first, lookup(nodes))).toMatchObject({ x: 110, y: 220 });
    expect(getNodeBounds(second, lookup(nodes))).toMatchObject({ x: 110, y: 220 });
    expect(nodes).toEqual(before);
  });

  it('当前节点之外的祖先形成循环时也能停止', () => {
    const first = node({ id: 'a', parentId: 'b' });
    const second = node({ id: 'b', parentId: 'a', position: { x: 100, y: 200 } });
    const child = node({ id: 'leaf', parentId: 'a', position: { x: 5, y: 7 } });
    const nodes = [first, second, child];
    expect(getParentOffset(child, lookup(nodes))).toEqual({ x: 110, y: 220 });
    expect(getNodeBounds(child, lookup(nodes))).toMatchObject({ x: 115, y: 227 });
    expect(first.parentId).toBe('b');
    expect(second.parentId).toBe('a');
  });

  it('父链中途缺失时保留已找到祖先的偏移', () => {
    const parent = node({ id: 'parent', parentId: 'missing', position: { x: 100, y: 200 } });
    const child = node({ parentId: 'parent' });
    expect(getParentOffset(child, lookup([parent, child]))).toEqual({ x: 100, y: 200 });
    expect(getNodeBounds(child, lookup([parent, child]))).toMatchObject({ x: 110, y: 220 });
  });

  it('合法多级父链保持坐标与尺寸，使用当前节点传入的位置', () => {
    const outer = node({ id: 'outer', position: { x: 100, y: 200 } });
    const inner = node({ id: 'inner', parentId: 'outer', position: { x: -30, y: 40 } });
    const child = node({ parentId: 'inner', measured: { width: 480, height: 88 } });
    const nodes = [outer, inner, child];
    expect(getParentOffset(child, lookup(nodes))).toEqual({ x: 70, y: 240 });
    expect(getNodeBounds({ ...child, position: { x: 20, y: 30 } }, lookup(nodes)))
      .toMatchObject({ x: 90, y: 270, width: 480, height: 88 });
  });
});

describe('尺寸在几何调用链中的应用', () => {
  it('深层父链通过 Map 迭代求值，不使用递归', () => {
    const parents = Array.from({ length: 2_000 }, (_, index) => node({
      id: `parent-${index}`, parentId: index ? `parent-${index - 1}` : undefined,
      position: { x: 1, y: -2 },
    }));
    const child = node({ parentId: 'parent-1999' });
    const nodeMap = new Map([...parents, child].map((item) => [item.id, item]));
    expect(getParentOffset(child, nodeMap)).toEqual({ x: 2000, y: -4000 });
    expect(getNodeBounds(child, nodeMap)).toMatchObject({ x: 2010, y: -3980 });
  });

  it('嵌套分组只叠加父级坐标，实测宽高保持不变', () => {
    const outer = node({ id: 'outer', type: 'group', position: { x: 500, y: 1000 } });
    const inner = node({ id: 'inner', type: 'group', parentId: 'outer', position: { x: 100, y: 200 } });
    const child = node({ parentId: 'inner', measured: { width: 480, height: 88 } });
    expect(getNodeBounds(child, [outer, inner, child])).toMatchObject({
      x: 610, y: 1220, width: 480, height: 88, right: 1090, bottom: 1308,
    });
  });

  it('多选分布的边缘间距采用实测边界', () => {
    const first = node({ id: 'a', position: { x: 0, y: 0 }, measured: { width: 200, height: 80 },
      data: { type: 'ai-image', label: 'a', nodeWidth: 100, nodeHeight: 160 } });
    const second = node({ id: 'b', position: { x: 300, y: 0 }, measured: { width: 80, height: 80 },
      data: { type: 'ai-image', label: 'b', nodeWidth: 100, nodeHeight: 160 } });
    const items = getDistributionItems([first, second], ['a', 'b'], 'horizontal');
    expect(items.map((item) => item.size)).toEqual([200, 80]);
    expect(getItemGap(items[0], items[1])).toBe(100);
  });
});

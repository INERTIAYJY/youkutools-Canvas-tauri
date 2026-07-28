import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';

vi.mock('../../src/services/fileService', () => ({
  setBaseDataDir: vi.fn(),
  syncAuthorizedDirectories: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/pollManager', () => ({
  cancelNodePolling: vi.fn(),
  clearProjectTasks: vi.fn(),
  resumePendingTasks: vi.fn(async () => undefined),
}));

import { useAppStore } from '../../src/store/useAppStore';

function node(id: string): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-text',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'ai-text', status: 'success' },
  };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('canvas clipboard', () => {
  it('keeps incoming connections without copying outgoing external connections', () => {
    const incomingEdge: Edge = {
      id: 'edge-source-copy',
      source: 'source',
      target: 'copy',
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    };
    const outgoingEdge: Edge = {
      id: 'edge-copy-downstream',
      source: 'copy',
      target: 'downstream',
    };
    useAppStore.setState({
      nodes: [node('source'), node('copy'), node('downstream')],
      edges: [incomingEdge, outgoingEdge],
      selectedNodeIds: ['copy'],
      showToast: vi.fn(),
    });

    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    const pastedNode = useAppStore.getState().nodes.find((item) => (
      !['source', 'copy', 'downstream'].includes(item.id)
    ));
    expect(pastedNode).toBeDefined();

    const pastedIncomingEdge = useAppStore.getState().edges.find((edge) => (
      edge.source === 'source' && edge.target === pastedNode?.id
    ));
    expect(pastedIncomingEdge).toMatchObject({
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    });
    expect(useAppStore.getState().edges).not.toContainEqual(expect.objectContaining({
      source: pastedNode?.id,
      target: 'downstream',
    }));
  });

  it('remaps both ends of connections between copied nodes', () => {
    useAppStore.setState({
      nodes: [node('first'), node('second')],
      edges: [{ id: 'edge-first-second', source: 'first', target: 'second' }],
      selectedNodeIds: ['first', 'second'],
      showToast: vi.fn(),
    });

    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    const pastedIds = useAppStore.getState().nodes
      .filter((item) => !['first', 'second'].includes(item.id))
      .map((item) => item.id);
    const pastedEdges = useAppStore.getState().edges.filter((edge) => (
      pastedIds.includes(edge.source) && pastedIds.includes(edge.target)
    ));
    expect(pastedEdges).toHaveLength(1);
  });
});

describe('control-drag duplication', () => {
  it('keeps incoming connections on both nodes without inheriting outgoing connections', () => {
    const incomingEdge: Edge = {
      id: 'edge-source-dragged',
      source: 'source',
      target: 'dragged',
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    };
    useAppStore.setState({
      nodes: [node('source'), node('dragged'), node('downstream')],
      edges: [
        incomingEdge,
        { id: 'edge-dragged-downstream', source: 'dragged', target: 'downstream' },
      ],
    });

    useAppStore.getState().duplicateNode('dragged');

    const stationaryClone = useAppStore.getState().nodes.find((item) => (
      !['source', 'dragged', 'downstream'].includes(item.id)
    ));
    expect(stationaryClone).toBeDefined();

    const incomingEdges = useAppStore.getState().edges.filter((edge) => edge.source === 'source');
    expect(incomingEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: stationaryClone?.id }),
      expect.objectContaining({
        target: 'dragged',
        sourceHandle: 'output',
        targetHandle: 'prompt',
        type: 'smoothstep',
        animated: true,
        data: { channel: 'reference' },
      }),
    ]));
    expect(useAppStore.getState().edges).not.toContainEqual(expect.objectContaining({
      source: 'dragged',
      target: 'downstream',
    }));
    expect(useAppStore.getState().edges).toContainEqual(expect.objectContaining({
      source: stationaryClone?.id,
      target: 'downstream',
    }));
  });
});

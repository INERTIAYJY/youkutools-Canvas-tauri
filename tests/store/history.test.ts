import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BaseNodeData, NodeGroup } from '../../src/types';
import { createCanvasNoteData } from '../../src/types';

const fileMocks = vi.hoisted(() => ({
  deleteNodeFile: vi.fn(async () => undefined),
  moveToUndoTrash: vi.fn(async () => undefined),
  restoreFromUndoTrash: vi.fn(async () => undefined),
  // 重做前会先确认文件属于当前项目，默认放行以保持既有断言
  isProjectOwnedFile: vi.fn(async () => true),
}));
const nodeExitMocks = vi.hoisted(() => {
  const pending = new Set<Promise<void>>();
  return {
    pending,
    playNodeExit: vi.fn<(_ids: string[]) => Promise<void>>(async () => undefined),
    waitForPendingNodeExits: vi.fn(async () => {
      await Promise.allSettled([...pending]);
      await Promise.resolve();
    }),
  };
});

vi.mock('../../src/services/fileService', () => ({
  ...fileMocks,
  setBaseDataDir: vi.fn(),
  syncAuthorizedDirectories: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/pollManager', () => ({
  cancelNodePolling: vi.fn(),
  clearProjectTasks: vi.fn(),
  resumePendingTasks: vi.fn(async () => undefined),
}));

vi.mock('../../src/utils/nodeAnimations', () => ({
  playNodeExit: nodeExitMocks.playNodeExit,
  waitForPendingNodeExits: nodeExitMocks.waitForPendingNodeExits,
}));

import { useAppStore } from '../../src/store/useAppStore';

function node(id: string, data: Partial<BaseNodeData> = {}): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-text',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'ai-text', status: 'success', ...data },
  };
}

function groupNode(id: string): Node<BaseNodeData> {
  return {
    id,
    type: 'group',
    position: { x: 40, y: 60 },
    data: {
      label: 'Group',
      type: 'comment',
      status: 'success',
      groupId: id,
      color: '#6366f1',
    } as unknown as BaseNodeData,
    style: { width: 400, height: 300 },
  };
}

function canvasNoteNode(id: string): Node<BaseNodeData> {
  const note = createCanvasNoteData('rectangle', { width: 160, height: 100 });
  return {
    id,
    type: 'canvas-note',
    position: { x: 10, y: 20 },
    data: {
      label: '矩形笔记',
      type: 'canvas-note',
      note,
      nodeWidth: note.width,
      nodeHeight: note.height,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nodeExitMocks.pending.clear();
  nodeExitMocks.playNodeExit.mockResolvedValue(undefined);
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('batch canvas history', () => {
  it('restores the first deleted batch with one undo and supports redo', async () => {
    const nodes = [
      node('node-a', { filePath: 'project/node-a.png' }),
      node('node-b'),
      node('node-c'),
    ];
    const edges: Edge[] = [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b' },
      { id: 'edge-b-c', source: 'node-b', target: 'node-c' },
    ];
    const groups: NodeGroup[] = [{
      id: 'group-1',
      name: 'Batch',
      nodeIds: ['node-a', 'node-b'],
      color: '#6366f1',
      createdAt: 1,
    }];
    useAppStore.setState({
      currentProjectId: 'project-1',
      nodes,
      edges,
      groups,
      history: [],
      historyIndex: -1,
    });
    const originalCommit = useAppStore.getState().commitToHistory;
    const commitSpy = vi.fn(() => originalCommit());
    useAppStore.setState({ commitToHistory: commitSpy });

    useAppStore.getState().deleteNodesBatch(['node-a', 'node-b']);

    await vi.waitFor(() => {
      expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-c']);
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState()).toMatchObject({ historyIndex: 0 });
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().edges).toEqual([]);
    expect(useAppStore.getState().groups).toEqual([]);

    await expect(useAppStore.getState().undo()).resolves.toBe(true);

    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual([
      'node-a',
      'node-b',
      'node-c',
    ]);
    expect(useAppStore.getState().edges.map((item) => item.id)).toEqual([
      'edge-a-b',
      'edge-b-c',
    ]);
    expect(useAppStore.getState().groups).toEqual(groups);
    expect(useAppStore.getState()).toMatchObject({ historyIndex: -1 });
    expect(fileMocks.restoreFromUndoTrash).toHaveBeenCalledWith('project/node-a.png');

    await expect(useAppStore.getState().redo()).resolves.toBe(true);

    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-c']);
    expect(useAppStore.getState()).toMatchObject({ historyIndex: 0 });
    expect(fileMocks.moveToUndoTrash).toHaveBeenCalledWith('project/node-a.png');
    await expect(useAppStore.getState().redo()).resolves.toBe(false);
  });

  it('removes an empty group with its last child and restores both through history', async () => {
    const group = groupNode('group-1');
    const child = { ...node('node-a'), parentId: group.id };
    const groups: NodeGroup[] = [{
      id: group.id,
      name: 'Group',
      nodeIds: [child.id],
      color: '#6366f1',
      createdAt: 1,
    }];
    useAppStore.setState({
      nodes: [group, child, node('node-b')],
      edges: [{ id: 'edge-group', source: group.id, target: 'node-b' }],
      groups,
      history: [],
      historyIndex: -1,
    });

    useAppStore.getState().deleteNode(child.id);

    await vi.waitFor(() => {
      expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-b']);
    });
    expect(useAppStore.getState().groups).toEqual([]);
    expect(useAppStore.getState().edges).toEqual([]);

    await expect(useAppStore.getState().undo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual([
      group.id,
      child.id,
      'node-b',
    ]);
    expect(useAppStore.getState().nodes[0].style).toEqual({ width: 400, height: 300 });
    expect(useAppStore.getState().groups).toEqual(groups);

    await expect(useAppStore.getState().redo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-b']);
    expect(useAppStore.getState().groups).toEqual([]);
  });

  it('removes an empty group when React Flow removes its last child', () => {
    const group = groupNode('group-1');
    const child = { ...node('node-a'), parentId: group.id };
    useAppStore.setState({
      nodes: [group, child],
      groups: [{
        id: group.id,
        name: 'Group',
        nodeIds: [child.id],
        color: '#6366f1',
        createdAt: 1,
      }],
      history: [],
      historyIndex: -1,
    });

    useAppStore.getState().onNodesChange([{ type: 'remove', id: child.id }]);

    expect(useAppStore.getState().nodes).toEqual([]);
    expect(useAppStore.getState().groups).toEqual([]);
    expect(useAppStore.getState().history).toHaveLength(1);
  });

  it('waits for a pending exit before restoring a quickly undone deletion', async () => {
    let finishExit!: () => void;
    const rawExit = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const trackedExit = rawExit.finally(() => nodeExitMocks.pending.delete(trackedExit));
    nodeExitMocks.pending.add(trackedExit);
    nodeExitMocks.playNodeExit.mockReturnValueOnce(trackedExit);
    useAppStore.setState({ nodes: [node('node-a')], history: [], historyIndex: -1 });

    useAppStore.getState().deleteNode('node-a');
    const undoResult = useAppStore.getState().undo();

    await vi.waitFor(() => {
      expect(nodeExitMocks.waitForPendingNodeExits).toHaveBeenCalled();
    });
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-a']);

    finishExit();
    await expect(undoResult).resolves.toBe(true);

    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-a']);
    expect(useAppStore.getState()).toMatchObject({ historyIndex: -1 });
  });

  it('does not create undo steps for position, size, or ordinary data changes', async () => {
    useAppStore.setState({ nodes: [node('node-a', { label: 'A', nodeWidth: 280, nodeHeight: 160 })], history: [], historyIndex: -1 });
    useAppStore.getState().commitToHistory();
    useAppStore.setState({
      nodes: [{
        ...useAppStore.getState().nodes[0],
        position: { x: 120, y: 80 },
        data: { ...useAppStore.getState().nodes[0].data, label: 'B', nodeWidth: 420, nodeHeight: 260 },
      }],
    });
    useAppStore.getState().commitToHistory();

    await expect(useAppStore.getState().undo()).resolves.toBe(false);
    expect(useAppStore.getState().nodes[0]).toMatchObject({
      position: { x: 120, y: 80 },
      data: { label: 'B', nodeWidth: 420, nodeHeight: 260 },
    });
  });

  it('undoes node creation without reverting existing node layout or data', async () => {
    useAppStore.setState({ nodes: [node('node-a', { label: 'A', nodeWidth: 280 })], history: [], historyIndex: -1 });
    useAppStore.getState().addNode(node('node-b'));
    useAppStore.setState({
      nodes: useAppStore.getState().nodes.map((item) => item.id === 'node-a'
        ? { ...item, position: { x: 75, y: 90 }, data: { ...item.data, label: 'Current', nodeWidth: 440 } }
        : item),
    });

    await expect(useAppStore.getState().undo()).resolves.toBe(true);

    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['node-a']);
    expect(useAppStore.getState().nodes[0]).toMatchObject({
      position: { x: 75, y: 90 },
      data: { label: 'Current', nodeWidth: 440 },
    });
    expect(useAppStore.getState().historyIndex).toBe(-1);
  });

  it('undoes an edge creation while keeping current node data', async () => {
    useAppStore.setState({
      nodes: [node('node-a', { label: 'A' }), node('node-b')],
      edges: [],
      history: [],
      historyIndex: -1,
    });
    useAppStore.getState().onConnect({
      source: 'node-a',
      target: 'node-b',
      sourceHandle: null,
      targetHandle: null,
    });
    useAppStore.setState({
      nodes: useAppStore.getState().nodes.map((item) => item.id === 'node-a'
        ? { ...item, data: { ...item.data, label: 'Current' } }
        : item),
    });

    await expect(useAppStore.getState().undo()).resolves.toBe(true);

    expect(useAppStore.getState().edges).toEqual([]);
    expect(useAppStore.getState().nodes[0].data.label).toBe('Current');
  });

  it('treats storyboard cell state as structural history', async () => {
    useAppStore.setState({
      nodes: [node('storyboard', {
        type: 'ai-storyboard',
        label: 'Before',
        storyboardExtracted: [false],
      })],
      history: [],
      historyIndex: -1,
    });
    useAppStore.getState().commitToHistory();
    useAppStore.setState({
      nodes: [{
        ...useAppStore.getState().nodes[0],
        data: {
          ...useAppStore.getState().nodes[0].data,
          label: 'Current',
          storyboardExtracted: [true],
        },
      }],
    });
    useAppStore.getState().commitToHistory();

    await expect(useAppStore.getState().undo()).resolves.toBe(true);

    expect(useAppStore.getState().nodes[0].data).toMatchObject({
      label: 'Current',
      storyboardExtracted: [false],
    });
  });

  it('undoes canvas note geometry and style without changing AI node history semantics', async () => {
    const note = canvasNoteNode('note-a');
    useAppStore.setState({ nodes: [note], history: [], historyIndex: -1 });

    expect(useAppStore.getState().updateCanvasNote('note-a', {
      width: 240,
      height: 140,
      style: { strokeColor: '#ef4444', opacity: 60 },
    })).toBe(true);
    useAppStore.getState().updateNodePositionTransient('note-a', { x: 80, y: 90 });

    await expect(useAppStore.getState().undo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes[0]).toMatchObject({
      position: { x: 10, y: 20 },
      data: {
        note: {
          width: 160,
          height: 100,
          style: { strokeColor: 'var(--theme-text)', opacity: 100 },
        },
      },
    });

    await expect(useAppStore.getState().redo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes[0]).toMatchObject({
      position: { x: 80, y: 90 },
      data: {
        note: {
          width: 240,
          height: 140,
          style: { strokeColor: '#ef4444', opacity: 60 },
        },
      },
    });
  });

  it('moves canvas notes through the shared layer order with one undo step', async () => {
    useAppStore.setState({
      nodes: [node('ai-a'), canvasNoteNode('note-a'), node('ai-b')],
      history: [],
      historyIndex: -1,
    });

    expect(useAppStore.getState().moveCanvasNoteLayer('note-a', 'front')).toBe(true);
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['ai-a', 'ai-b', 'note-a']);

    await expect(useAppStore.getState().undo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['ai-a', 'note-a', 'ai-b']);
  });

  it('undoes and redoes character-library node hiding with its association', async () => {
    useAppStore.setState({
      nodes: [node('character-image', { type: 'ai-image', imageUrl: 'asset://character.png' })],
      history: [],
      historyIndex: -1,
    });

    expect(useAppStore.getState().linkNodeToCharacter('character-image', {
      scope: 'project',
      characterId: 'character-1',
      referenceImageId: 'reference-1',
    }, true)).toBe(true);
    expect(useAppStore.getState().nodes[0].data).toMatchObject({
      hiddenByCharacterLibrary: true,
      characterLibraryLinks: [{
        scope: 'project',
        characterId: 'character-1',
        referenceImageId: 'reference-1',
      }],
    });

    await expect(useAppStore.getState().undo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes[0].data.hiddenByCharacterLibrary).toBeUndefined();
    expect(useAppStore.getState().nodes[0].data.characterLibraryLinks).toBeUndefined();

    await expect(useAppStore.getState().redo()).resolves.toBe(true);
    expect(useAppStore.getState().nodes[0].data.hiddenByCharacterLibrary).toBe(true);
    expect(useAppStore.getState().nodes[0].data.characterLibraryLinks).toEqual([{
      scope: 'project',
      characterId: 'character-1',
      referenceImageId: 'reference-1',
    }]);
  });
});

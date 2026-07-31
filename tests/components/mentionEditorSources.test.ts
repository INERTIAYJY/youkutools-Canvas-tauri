import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';
import {
  resolveCanvasMentionNodes,
  resolveWorkflowMentionNodes,
} from '../../src/components/nodes/shared/mentionEditorSources';

function node(
  id: string,
  type: BaseNodeData['type'],
  data: Partial<BaseNodeData> = {},
  parentId?: string,
): Node<BaseNodeData> {
  return {
    id,
    type,
    parentId,
    position: { x: 0, y: 0 },
    data: { label: id, type, ...data },
  };
}

describe('mentionEditorSources', () => {
  it('expands connected groups and storyboard cells into mention candidates', () => {
    const nodes = [
      { ...node('group', 'comment'), type: 'group' },
      node('storyboard', 'ai-storyboard', {
        imageUrl: 'asset://storyboard.png',
        storyboardCols: 2,
        storyboardRows: 1,
        storyboardExtracted: [false, true],
      }, 'group'),
      node('target', 'ai-text'),
    ];
    const edges: Edge[] = [{ id: 'edge-group-target', source: 'group', target: 'target' }];

    const candidates = resolveCanvasMentionNodes('target', nodes, edges);

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'storyboard',
      'storyboard/cell/0',
    ]);
    expect(candidates[1]).toMatchObject({
      type: 'ai-image',
      label: 'storyboard · 第1行1列',
      thumbnailUrl: 'asset://storyboard.png',
    });
  });

  it('places a node with its own output before connected candidates', () => {
    const nodes = [
      node('source', 'ai-text', { output: 'source output' }),
      node('target', 'ai-image', { imageUrl: 'asset://target.png' }),
    ];
    const edges: Edge[] = [{ id: 'edge-source-target', source: 'source', target: 'target' }];

    const candidates = resolveCanvasMentionNodes('target', nodes, edges);

    expect(candidates.map((candidate) => candidate.id)).toEqual(['target', 'source']);
    expect(candidates[0]).toMatchObject({ isSelf: true, outputType: 'image' });
  });

  it('maps workflow IO nodes only when a workflow is selected', () => {
    const ioNodes = [{ nodeId: '12', title: '提示词', type: 'prompt' as const }];

    expect(resolveWorkflowMentionNodes(undefined, ioNodes)).toEqual([]);
    expect(resolveWorkflowMentionNodes('workflow-a', ioNodes)).toEqual([{
      id: 'wf:12',
      label: '提示词',
      _ioNodeId: '12',
      _ioType: 'prompt',
    }]);
  });
});

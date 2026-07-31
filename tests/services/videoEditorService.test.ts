import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const windowMocks = vi.hoisted(() => ({
  openVideoEditorWindow: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/videoEditorWindowService', () => ({
  openVideoEditorWindow: windowMocks.openVideoEditorWindow,
}));

import {
  buildVideoEditorProjectId,
  deleteVideoEditorProject,
  getVideoEditorProject,
  listVideoEditorProjectsByProject,
  saveVideoEditorProject,
} from '../../src/services/indexedDb/videoEditorRepository';
import {
  canEditNodeVideo,
  openVideoEditorForNode,
  openVideoEditorForNodes,
} from '../../src/services/videoEditorService';
import {
  DEFAULT_IMAGE_CLIP_DURATION,
  VIDEO_EDITOR_SCHEMA_VERSION,
  computeTimelineDuration,
  getPrimaryClip,
  type VideoEditorProjectRecord,
  type VideoEditorTrack,
} from '../../src/types/videoEditor';
import type { BaseNodeData } from '../../src/types';

function buildRecord(overrides: Partial<VideoEditorProjectRecord> = {}): VideoEditorProjectRecord {
  return {
    id: 'proj-1::node-1',
    schemaVersion: VIDEO_EDITOR_SCHEMA_VERSION,
    projectId: 'proj-1',
    nodeId: 'node-1',
    name: '测试剪辑',
    tracks: [{
      id: 'video-1',
      kind: 'video',
      name: '视频轨 1',
      clips: [{
        id: 'clip-1',
        kind: 'video',
        filePath: '/data/a.mp4',
        fileName: 'a.mp4',
        timelineStart: 0,
        sourceIn: 1,
        sourceOut: 5,
      }],
    }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// openDB() 在模块级缓存连接，换 IDBFactory 也换不掉它，
// 因此全文件共用一个库，靠各用例的独立 id 保持互不干扰。
globalThis.indexedDB = new IDBFactory();

describe('videoEditor 数据层', () => {

  it('builds a stable project id from project + node', () => {
    expect(buildVideoEditorProjectId('proj-1', 'node-1')).toBe('proj-1::node-1');
  });

  it('round-trips a project record', async () => {
    await saveVideoEditorProject(buildRecord({ id: 'rt::node', nodeId: 'node' }));
    const loaded = await getVideoEditorProject('rt::node');
    expect(loaded?.name).toBe('测试剪辑');
    expect(getPrimaryClip(loaded!.tracks)?.sourceOut).toBe(5);
  });

  it('treats records written by a newer schema as absent', async () => {
    await saveVideoEditorProject(buildRecord({
      id: 'future::node',
      schemaVersion: VIDEO_EDITOR_SCHEMA_VERSION + 1,
    }));
    expect(await getVideoEditorProject('future::node')).toBeNull();
  });

  it('lists only the requested canvas project, newest first', async () => {
    await saveVideoEditorProject(buildRecord({
      id: 'list-a::n1', projectId: 'list-a', nodeId: 'n1', updatedAt: 10,
    }));
    await saveVideoEditorProject(buildRecord({
      id: 'list-a::n2', projectId: 'list-a', nodeId: 'n2', updatedAt: 20,
    }));
    await saveVideoEditorProject(buildRecord({
      id: 'list-b::n3', projectId: 'list-b', nodeId: 'n3', updatedAt: 30,
    }));

    const listed = await listVideoEditorProjectsByProject('list-a');
    expect(listed.map((record) => record.nodeId)).toEqual(['n2', 'n1']);
  });

  it('deletes a project record', async () => {
    await saveVideoEditorProject(buildRecord({ id: 'del::node', nodeId: 'node' }));
    await deleteVideoEditorProject('del::node');
    expect(await getVideoEditorProject('del::node')).toBeNull();
  });
});

describe('computeTimelineDuration', () => {
  it('returns the furthest clip end across tracks', () => {
    const tracks: VideoEditorTrack[] = [
      {
        id: 'v1', kind: 'video', name: 'v', clips: [
          { id: 'c1', kind: 'video', fileName: 'a', timelineStart: 0, sourceIn: 0, sourceOut: 4 },
        ],
      },
      {
        id: 'a1', kind: 'audio', name: 'a', clips: [
          { id: 'c2', kind: 'video', fileName: 'b', timelineStart: 3, sourceIn: 2, sourceOut: 6 },
        ],
      },
    ];
    // 音频片段 3 + (6-2) = 7 超过视频轨的 4
    expect(computeTimelineDuration(tracks)).toBe(7);
  });

  it('returns 0 for empty tracks', () => {
    expect(computeTimelineDuration([])).toBe(0);
  });
});

describe('canEditNodeVideo', () => {
  it('requires a local file or a video url', () => {
    expect(canEditNodeVideo(undefined)).toBe(false);
    expect(canEditNodeVideo({} as BaseNodeData)).toBe(false);
    expect(canEditNodeVideo({ filePath: '/a.mp4' } as BaseNodeData)).toBe(true);
    expect(canEditNodeVideo({ videoUrl: 'asset://a.mp4' } as BaseNodeData)).toBe(true);
  });
});

describe('openVideoEditorForNode', () => {
  beforeEach(() => {
    windowMocks.openVideoEditorWindow.mockClear();
  });

  it('rejects when no project is open', async () => {
    await expect(openVideoEditorForNode({
      projectId: '',
      nodeId: 'node-1',
      data: { filePath: '/a.mp4' } as BaseNodeData,
    })).rejects.toThrow('请先打开一个项目');
  });

  it('rejects a node without editable media', async () => {
    await expect(openVideoEditorForNode({
      projectId: 'proj-1',
      nodeId: 'node-1',
      data: {} as BaseNodeData,
    })).rejects.toThrow('没有可编辑的视频素材');
  });

  it('creates the project before opening the window', async () => {
    await openVideoEditorForNode({
      projectId: 'open-new',
      nodeId: 'node-1',
      data: {
        type: 'ai-video',
        filePath: '/data/a.mp4',
        fileName: 'a.mp4',
        label: '镜头一',
        videoDuration: 8,
      } as unknown as BaseNodeData,
    });

    const created = await getVideoEditorProject('open-new::node-1');
    expect(created?.name).toBe('镜头一');
    const clip = getPrimaryClip(created!.tracks);
    expect(clip?.filePath).toBe('/data/a.mp4');
    expect(clip?.sourceOut).toBe(8);
    expect(windowMocks.openVideoEditorWindow).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'open-new::node-1', nodeId: 'node-1' }),
    );
  });

  it('leaves the out point at 0 for the editor to backfill when duration is unknown', async () => {
    await openVideoEditorForNode({
      projectId: 'open-nodur',
      nodeId: 'node-2',
      data: { filePath: '/data/b.mp4' } as BaseNodeData,
    });

    const created = await getVideoEditorProject('open-nodur::node-2');
    expect(getPrimaryClip(created!.tracks)?.sourceOut).toBe(0);
  });

  it('reuses an existing project instead of resetting its trim', async () => {
    await saveVideoEditorProject(buildRecord({
      id: 'open-reuse::node-1', projectId: 'open-reuse', name: '旧工程',
    }));

    await openVideoEditorForNode({
      projectId: 'open-reuse',
      nodeId: 'node-1',
      data: { filePath: '/data/a.mp4', label: '新标题' } as BaseNodeData,
    });

    const loaded = await getVideoEditorProject('open-reuse::node-1');
    expect(loaded?.name).toBe('旧工程');
    expect(getPrimaryClip(loaded!.tracks)?.sourceIn).toBe(1);
    expect(windowMocks.openVideoEditorWindow).toHaveBeenCalled();
  });
});

describe('openVideoEditorForNodes', () => {
  beforeEach(() => {
    windowMocks.openVideoEditorWindow.mockClear();
  });

  const videoNode = (id: string, label: string) => ({
    id,
    type: 'ai-video',
    data: { filePath: `/data/${id}.mp4`, label, videoDuration: 4 } as unknown as BaseNodeData,
  });
  const imageNode = (id: string) => ({
    id,
    type: 'source-image',
    data: { filePath: `/data/${id}.png`, imageUrl: `asset://${id}.png` } as unknown as BaseNodeData,
  });

  it('lays multiple selected clips out head to tail in selection order', async () => {
    await openVideoEditorForNodes({
      projectId: 'multi-a',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });

    const created = await getVideoEditorProject('multi-a::n1');
    const clips = created!.tracks[0].clips;
    expect(clips.map((clip) => clip.nodeId)).toEqual(['n1', 'n2']);
    expect(clips.map((clip) => clip.timelineStart)).toEqual([0, 4]);
    expect(created!.nodeIds).toEqual(['n1', 'n2']);
  });

  it('anchors the project on the first node so the export writes back there', async () => {
    await openVideoEditorForNodes({
      projectId: 'multi-b',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });

    const created = await getVideoEditorProject('multi-b::n1');
    expect(created!.nodeId).toBe('n1');
    expect(windowMocks.openVideoEditorWindow).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'multi-b::n1', nodeId: 'n1' }),
    );
  });

  it('accepts images alongside videos and gives them a fixed duration', async () => {
    await openVideoEditorForNodes({
      projectId: 'multi-c',
      nodes: [videoNode('n1', '镜头一'), imageNode('img1')],
    });

    const clips = (await getVideoEditorProject('multi-c::n1'))!.tracks[0].clips;
    expect(clips[1].kind).toBe('image');
    expect(clips[1].sourceOut).toBe(DEFAULT_IMAGE_CLIP_DURATION);
    expect(clips[1].timelineStart).toBe(4);
  });

  it('rejects a selection that has no video at all', async () => {
    await expect(openVideoEditorForNodes({
      projectId: 'multi-d',
      nodes: [imageNode('img1'), imageNode('img2')],
    })).rejects.toThrow('至少需要选中一个视频节点');
  });

  it('skips nodes that carry no usable media', async () => {
    await openVideoEditorForNodes({
      projectId: 'multi-e',
      nodes: [
        videoNode('n1', '镜头一'),
        { id: 'empty', type: 'ai-video', data: {} as unknown as BaseNodeData },
      ],
    });

    const clips = (await getVideoEditorProject('multi-e::n1'))!.tracks[0].clips;
    expect(clips).toHaveLength(1);
  });

  it('names the project after the anchor plus the clip count', async () => {
    await openVideoEditorForNodes({
      projectId: 'multi-f',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二'), videoNode('n3', '镜头三')],
    });

    expect((await getVideoEditorProject('multi-f::n1'))!.name).toBe('镜头一 等 3 个素材');
  });
});

describe('openVideoEditorForNodes 合并已有工程', () => {
  beforeEach(() => {
    windowMocks.openVideoEditorWindow.mockClear();
  });

  const videoNode = (id: string, label: string) => ({
    id,
    type: 'ai-video',
    data: { filePath: `/data/${id}.mp4`, label, videoDuration: 4 } as unknown as BaseNodeData,
  });

  it('appends newly selected clips to a project opened earlier with fewer nodes', async () => {
    // 先只打开 n1，再多选 [n1, n2]：n2 必须出现在时间轴上
    await openVideoEditorForNodes({
      projectId: 'merge-a',
      nodes: [videoNode('n1', '镜头一')],
    });
    await openVideoEditorForNodes({
      projectId: 'merge-a',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });

    const merged = await getVideoEditorProject('merge-a::n1');
    expect(merged!.tracks[0].clips.map((clip) => clip.nodeId)).toEqual(['n1', 'n2']);
    expect(merged!.nodeIds).toEqual(['n1', 'n2']);
    expect(merged!.tracks[0].clips.map((clip) => clip.timelineStart)).toEqual([0, 4]);
  });

  it('keeps existing trims when appending', async () => {
    await openVideoEditorForNodes({
      projectId: 'merge-b',
      nodes: [videoNode('n1', '镜头一')],
    });

    const before = (await getVideoEditorProject('merge-b::n1'))!;
    before.tracks[0].clips[0] = { ...before.tracks[0].clips[0], sourceIn: 1, sourceOut: 3 };
    await saveVideoEditorProject(before);

    await openVideoEditorForNodes({
      projectId: 'merge-b',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });

    const after = (await getVideoEditorProject('merge-b::n1'))!;
    expect(after.tracks[0].clips[0].sourceIn).toBe(1);
    expect(after.tracks[0].clips[0].sourceOut).toBe(3);
    // 追加的片段接在裁剪后的时长之后
    expect(after.tracks[0].clips[1].timelineStart).toBe(2);
  });

  it('leaves the project untouched when the selection is already covered', async () => {
    await openVideoEditorForNodes({
      projectId: 'merge-c',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });
    const before = (await getVideoEditorProject('merge-c::n1'))!;

    // 只右键其中一个节点重新打开，不该把另一段清掉
    await openVideoEditorForNodes({
      projectId: 'merge-c',
      nodes: [videoNode('n1', '镜头一')],
    });

    const after = (await getVideoEditorProject('merge-c::n1'))!;
    expect(after.tracks[0].clips).toHaveLength(2);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('does not duplicate a clip when the same node is selected again', async () => {
    await openVideoEditorForNodes({
      projectId: 'merge-d',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });
    await openVideoEditorForNodes({
      projectId: 'merge-d',
      nodes: [videoNode('n1', '镜头一'), videoNode('n2', '镜头二')],
    });

    const after = (await getVideoEditorProject('merge-d::n1'))!;
    expect(after.tracks[0].clips).toHaveLength(2);
  });
});

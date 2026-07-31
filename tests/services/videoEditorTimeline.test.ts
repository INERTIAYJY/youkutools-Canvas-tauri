import { describe, expect, it } from 'vitest';

import {
  findClipAtTime,
  getClipDuration,
  relayoutSequential,
  splitClipsAt,
  type VideoEditorClip,
} from '../../src/types/videoEditor';

function clip(overrides: Partial<VideoEditorClip> & { id: string }): VideoEditorClip {
  return {
    kind: 'video',
    fileName: `${overrides.id}.mp4`,
    timelineStart: 0,
    sourceIn: 0,
    sourceOut: 5,
    ...overrides,
  };
}

describe('relayoutSequential', () => {
  it('packs clips head to tail regardless of their previous positions', () => {
    const laid = relayoutSequential([
      clip({ id: 'a', timelineStart: 99, sourceIn: 0, sourceOut: 4 }),
      clip({ id: 'b', timelineStart: 3, sourceIn: 2, sourceOut: 5 }),
      clip({ id: 'c', timelineStart: 0, sourceIn: 1, sourceOut: 3 }),
    ]);
    expect(laid.map((entry) => entry.timelineStart)).toEqual([0, 4, 7]);
  });

  it('keeps every clip untouched apart from its position', () => {
    const [only] = relayoutSequential([clip({ id: 'a', sourceIn: 1, sourceOut: 4 })]);
    expect(only.sourceIn).toBe(1);
    expect(only.sourceOut).toBe(4);
    expect(getClipDuration(only)).toBe(3);
  });
});

describe('findClipAtTime', () => {
  const clips = relayoutSequential([
    clip({ id: 'a', sourceOut: 4 }),
    clip({ id: 'b', sourceOut: 6 }),
  ]);

  it('resolves the clip covering the given time', () => {
    expect(findClipAtTime(clips, 0)?.clip.id).toBe('a');
    expect(findClipAtTime(clips, 3.9)?.clip.id).toBe('a');
    expect(findClipAtTime(clips, 4)?.clip.id).toBe('b');
    expect(findClipAtTime(clips, 9)?.clip.id).toBe('b');
  });

  it('includes the very end of the timeline in the last clip', () => {
    // 末片段用闭区间，播放头停在结尾时仍要有归属
    expect(findClipAtTime(clips, 10)?.clip.id).toBe('b');
  });

  it('returns null past the end and for empty timelines', () => {
    expect(findClipAtTime(clips, 10.5)).toBeNull();
    expect(findClipAtTime([], 0)).toBeNull();
  });
});

describe('splitClipsAt', () => {
  it('splits one clip into two adjoining clips', () => {
    const clips = relayoutSequential([clip({ id: 'a', sourceIn: 2, sourceOut: 10 })]);
    const split = splitClipsAt(clips, 3);

    expect(split).not.toBeNull();
    expect(split).toHaveLength(2);
    const [head, tail] = split!;
    // 时间轴 3s 处对应素材 2 + 3 = 5s
    expect(head.sourceIn).toBe(2);
    expect(head.sourceOut).toBe(5);
    expect(tail.sourceIn).toBe(5);
    expect(tail.sourceOut).toBe(10);
    expect(head.timelineStart).toBe(0);
    expect(tail.timelineStart).toBe(3);
  });

  it('splits the correct clip in a multi-clip timeline', () => {
    const clips = relayoutSequential([
      clip({ id: 'a', sourceOut: 4 }),
      clip({ id: 'b', sourceIn: 0, sourceOut: 6 }),
    ]);
    const split = splitClipsAt(clips, 6);

    expect(split).toHaveLength(3);
    expect(split!.map((entry) => getClipDuration(entry))).toEqual([4, 2, 4]);
  });

  it('gives the tail a fresh id so React keys stay unique', () => {
    const clips = relayoutSequential([clip({ id: 'a', sourceOut: 10 })]);
    const split = splitClipsAt(clips, 5)!;
    expect(split[0].id).toBe('a');
    expect(split[1].id).not.toBe('a');
  });

  it('refuses to split too close to either edge', () => {
    const clips = relayoutSequential([clip({ id: 'a', sourceOut: 10 })]);
    expect(splitClipsAt(clips, 0)).toBeNull();
    expect(splitClipsAt(clips, 0.01)).toBeNull();
    expect(splitClipsAt(clips, 9.99)).toBeNull();
  });

  it('refuses to split outside any clip', () => {
    const clips = relayoutSequential([clip({ id: 'a', sourceOut: 4 })]);
    expect(splitClipsAt(clips, 99)).toBeNull();
    expect(splitClipsAt([], 1)).toBeNull();
  });

  it('preserves total duration across a split', () => {
    const clips = relayoutSequential([
      clip({ id: 'a', sourceOut: 4 }),
      clip({ id: 'b', sourceOut: 6 }),
    ]);
    const before = clips.reduce((sum, entry) => sum + getClipDuration(entry), 0);
    const after = splitClipsAt(clips, 5)!
      .reduce((sum, entry) => sum + getClipDuration(entry), 0);
    expect(after).toBeCloseTo(before, 10);
  });
});

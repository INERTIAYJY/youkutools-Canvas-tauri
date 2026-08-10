import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOT_DURATION,
  buildShotPlaceholderText,
  computeShotlistDuration,
  createShotRow,
  isShotRowBlank,
  isShotRowTextOnly,
  resolveShotDuration,
  resolveShotTransitionKind,
} from '../../src/types/shotlist';
import type { ShotRow } from '../../src/types/shotlist';

function row(overrides: Partial<ShotRow> = {}): ShotRow {
  return { ...createShotRow('row-1', 1), ...overrides };
}

describe('分镜表行状态判定', () => {
  it('新建的空行算空行', () => {
    expect(isShotRowBlank(createShotRow('r', 1))).toBe(true);
  });

  it('只填了内容也不算空行', () => {
    expect(isShotRowBlank(row({ content: '警察松动警戒线' }))).toBe(false);
    expect(isShotRowTextOnly(row({ content: '警察松动警戒线' }))).toBe(true);
  });

  it('只有空白字符仍算空行', () => {
    expect(isShotRowBlank(row({ content: '   ', dialogue: '\n' }))).toBe(true);
  });

  it('绑了画面就不是纯文字行', () => {
    const bound = row({ frame: { nodeId: 'node-9', kind: 'image' } });
    expect(isShotRowBlank(bound)).toBe(false);
    expect(isShotRowTextOnly(bound)).toBe(false);
  });
});

describe('镜头时长解析', () => {
  it('优先用表里填的时长', () => {
    expect(resolveShotDuration(row({ duration: 7 }))).toBe(7);
  });

  it('视频行没填时长时回落到源片长', () => {
    const shot = row({
      duration: undefined,
      frame: { nodeId: 'n', kind: 'video', sourceDuration: 12 },
    });
    expect(resolveShotDuration(shot)).toBe(12);
  });

  it('什么都没有时用默认停留时长', () => {
    expect(resolveShotDuration(row({ duration: undefined }))).toBe(DEFAULT_SHOT_DURATION);
    // 0 和负数是无效输入，不能让片段塌成零长
    expect(resolveShotDuration(row({ duration: 0 }))).toBe(DEFAULT_SHOT_DURATION);
  });

  it('总时长跳过空行', () => {
    const rows = [
      row({ id: 'a', duration: 3, content: '甲' }),
      createShotRow('blank', 2),
      row({ id: 'c', duration: 2, content: '乙' }),
    ];
    expect(computeShotlistDuration(rows)).toBe(5);
  });
});

describe('转场映射到剪辑器', () => {
  it('认识的写法映射到对应转场', () => {
    expect(resolveShotTransitionKind('叠化')).toBe('dissolve');
    expect(resolveShotTransitionKind('淡入淡出')).toBe('fade');
    expect(resolveShotTransitionKind('切')).toBe('none');
  });

  it('剪辑器不支持的写法按硬切处理，不报错', () => {
    expect(resolveShotTransitionKind('划像')).toBe('none');
    expect(resolveShotTransitionKind('')).toBe('none');
    expect(resolveShotTransitionKind(undefined)).toBe('none');
  });
});

describe('无画面行的占位文字', () => {
  it('镜号、景别、运镜拼成抬头，内容另起一行', () => {
    const text = buildShotPlaceholderText(row({
      shotNo: '1', shotSize: '全景', camera: '固定', content: '警察松动警戒线',
    }));
    expect(text).toBe('1 · 全景 · 固定\n警察松动警戒线');
  });

  it('没有内容时退而用台词', () => {
    expect(buildShotPlaceholderText(row({ shotNo: '2', content: '', dialogue: '安警官是自己人' })))
      .toBe('2\n安警官是自己人');
  });

  it('全空也要给个能看的名字', () => {
    expect(buildShotPlaceholderText({ id: 'x', shotNo: '' })).toBe('未命名镜头');
  });
});

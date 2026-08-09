import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_PRESENT_FALLBACK_MS,
  VIDEO_SEEK_TIMEOUT_MS,
  seekVideoTo,
} from '../../src/utils/videoSeek';

interface FakeVideoOptions {
  /** 赋值 currentTime 后是否真的进入 seeking */
  seeks?: boolean;
  /** 提供 requestVideoFrameCallback；调用后是否真的回调由 presentsFrames 决定 */
  hasFrameCallback?: boolean;
  presentsFrames?: boolean;
}

function createFakeVideo(options: FakeVideoOptions = {}) {
  const { seeks = true, hasFrameCallback = true, presentsFrames = false } = options;
  const listeners = new Map<string, Set<() => void>>();
  const framePresentedCallbacks: Array<() => void> = [];

  const video = {
    currentTime: 0,
    seeking: false,
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    ...(hasFrameCallback
      ? {
          requestVideoFrameCallback(callback: () => void) {
            if (presentsFrames) callback();
            else framePresentedCallbacks.push(callback);
          },
        }
      : {}),
  } as unknown as HTMLVideoElement & { seeking: boolean };

  // currentTime 赋值即进入 seeking，与浏览器同步行为一致
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value: number) => {
      if (!seeks) return;
      time = value;
      (video as { seeking: boolean }).seeking = true;
    },
  });

  return {
    video,
    fireSeeked() {
      (video as { seeking: boolean }).seeking = false;
      for (const listener of listeners.get('seeked') ?? []) listener();
    },
    pendingFrameCallbacks: framePresentedCallbacks,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('seekVideoTo', () => {
  it('已经在目标位置时直接返回', async () => {
    const { video } = createFakeVideo();
    await expect(seekVideoTo(video, 0)).resolves.toBeUndefined();
  });

  it('rVFC 一直不回调时，按兜底时长继续，不再报定位超时', async () => {
    const fake = createFakeVideo({ presentsFrames: false });
    const seek = seekVideoTo(fake.video, 3);
    fake.fireSeeked();

    // 帧回调没来，兜底定时器接管
    expect(fake.pendingFrameCallbacks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FRAME_PRESENT_FALLBACK_MS);
    await expect(seek).resolves.toBeUndefined();
  });

  it('rVFC 正常回调时立刻返回，不等兜底', async () => {
    const fake = createFakeVideo({ presentsFrames: true });
    const seek = seekVideoTo(fake.video, 3);
    fake.fireSeeked();

    await vi.advanceTimersByTimeAsync(0);
    await expect(seek).resolves.toBeUndefined();
  });

  it('目标被钳回当前位置、不会有 seeked 事件时也能返回', async () => {
    const fake = createFakeVideo({ seeks: false });
    const seek = seekVideoTo(fake.video, 9999);
    await expect(seek).resolves.toBeUndefined();
  });

  it('seeked 一直不来才报定位超时', async () => {
    const fake = createFakeVideo();
    const seek = seekVideoTo(fake.video, 3);
    const assertion = expect(seek).rejects.toThrow('视频定位超时');
    await vi.advanceTimersByTimeAsync(VIDEO_SEEK_TIMEOUT_MS);
    await assertion;
  });
});

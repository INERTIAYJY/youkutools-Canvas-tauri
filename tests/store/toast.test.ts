import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast 自动消失', () => {
  it('普通消息 2.5 秒后消失', () => {
    useAppStore.getState().showToast('已复制');
    vi.advanceTimersByTime(2_400);
    expect(useAppStore.getState().toast.visible).toBe(true);
    vi.advanceTimersByTime(200);
    expect(useAppStore.getState().toast.visible).toBe(false);
  });

  it('报错留够读完和复制的时间', () => {
    useAppStore.getState().showToast('接口炸了', 'error');
    vi.advanceTimersByTime(10_000);
    expect(useAppStore.getState().toast.visible).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(useAppStore.getState().toast.visible).toBe(false);
  });

  it('上一条报错的定时器不会提前关掉新消息', () => {
    useAppStore.getState().showToast('接口炸了', 'error');
    vi.advanceTimersByTime(14_000);
    useAppStore.getState().showToast('已复制');

    // 旧定时器原本会在这一刻触发
    vi.advanceTimersByTime(1_000);
    expect(useAppStore.getState().toast).toMatchObject({ visible: true, message: '已复制' });

    vi.advanceTimersByTime(1_600);
    expect(useAppStore.getState().toast.visible).toBe(false);
  });
});

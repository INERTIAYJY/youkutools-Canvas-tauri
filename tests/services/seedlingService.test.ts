/**
 * seedlingService — 森之灵 CLI 服务层（任务轮询与参数传递）测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/core', () => coreMocks);

import { useAppStore } from '../../src/store/useAppStore';
import {
  createSeedlingVideoTask,
  fetchSeedlingCliStatus,
  waitSeedlingTask,
} from '../../src/services/seedlingService';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  coreMocks.invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSeedlingVideoTask', () => {
  it('把输入参数与 API Token 一并传给 Rust 命令', async () => {
    useAppStore.setState({
      config: {
        ...useAppStore.getState().config,
        providers: { ...useAppStore.getState().config.providers, seedling: { name: 'seedling', apiKey: 'sl-test-token' } },
      },
    });
    coreMocks.invoke.mockResolvedValue({ taskId: 20001 });

    const result = await createSeedlingVideoTask({
      prompt: '黄昏下的城市',
      model: 'quality',
      duration: 8,
      resolution: '720p',
      ratio: '16:9',
      audio: true,
    });

    expect(result).toEqual({ taskId: 20001 });
    expect(coreMocks.invoke).toHaveBeenCalledWith('seedling_task_create', {
      params: {
        prompt: '黄昏下的城市',
        model: 'quality',
        duration: 8,
        resolution: '720p',
        ratio: '16:9',
        audio: true,
      },
      apiToken: 'sl-test-token',
    });
  });
});

describe('fetchSeedlingCliStatus', () => {
  it('透传 CLI 探测结果', async () => {
    coreMocks.invoke.mockResolvedValue({
      found: true,
      source: 'system',
      version: '0.0.4',
      auth: { loggedIn: true, username: '测试用户', endpoint: 'https://seedling.p.ykss.com.cn' },
      error: null,
    });
    const status = await fetchSeedlingCliStatus();
    expect(status.found).toBe(true);
    expect(status.auth?.username).toBe('测试用户');
  });
});

describe('waitSeedlingTask', () => {
  it('轮询直到 succeeded 并返回任务详情', async () => {
    vi.useFakeTimers();
    try {
      const responses = [
        { taskId: 30001, status: 'queued', videoUrl: null },
        { taskId: 30001, status: 'running', videoUrl: null },
        { taskId: 30001, status: 'succeeded', videoUrl: 'https://cdn.example/out.mp4' },
      ];
      coreMocks.invoke
        .mockResolvedValueOnce(responses[0])
        .mockResolvedValueOnce(responses[1])
        .mockResolvedValueOnce(responses[2]);

      const promise = waitSeedlingTask(30001);
      // 第一次调用立即执行；之后每次间隔 3000ms
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      const task = await promise;
      expect(task.status).toBe('succeeded');
      expect(task.videoUrl).toBe('https://cdn.example/out.mp4');
      expect(coreMocks.invoke).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('failed 状态抛出错误信息', async () => {
    coreMocks.invoke.mockResolvedValue({
      taskId: 30002,
      status: 'failed',
      videoUrl: null,
      errorMessage: '输出视频违规',
    });
    await expect(waitSeedlingTask(30002)).rejects.toThrow('输出视频违规');
  });

  it('cancelled 状态抛出取消提示', async () => {
    coreMocks.invoke.mockResolvedValue({
      taskId: 30003,
      status: 'cancelled',
      videoUrl: null,
    });
    await expect(waitSeedlingTask(30003)).rejects.toThrow(/cancelled/);
  });
});

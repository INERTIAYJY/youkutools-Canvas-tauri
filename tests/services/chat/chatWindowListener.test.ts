/**
 * chatWindowListener — 回归测试：initMainWindowListener。
 */
import { describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(handler);
    listeners.set(name, set);
    return () => set.delete(handler);
  }),
  emit: vi.fn(async () => undefined),
}));

import { emit } from '@tauri-apps/api/event';

import {
  CHAT_ACTION_EVENT,
  CHAT_CLOSE_REQUEST,
  emitCloseRequest,
  initMainWindowListener,
} from '../../../src/services/chat/chatWindowService';

describe('initMainWindowListener', () => {
  it('carries the last composer edit with the close request', async () => {
    const onClose = vi.fn();
    const dispose = await initMainWindowListener(vi.fn(), onClose);
    const composerDraft = { conversationId: 'conversation-1', draft: '还没来得及防抖的输入' };
    await emitCloseRequest(composerDraft);
    expect(emit).toHaveBeenCalledWith(CHAT_CLOSE_REQUEST, { composerDraft });
    for (const handler of listeners.get(CHAT_CLOSE_REQUEST) ?? []) handler({ payload: { composerDraft } });
    expect(onClose).toHaveBeenCalledWith(composerDraft);
    dispose();
  });
  it('re-registers after a disposed mount (StrictMode double-invoke)', async () => {
    // 第一次挂载：注册后立即被 cleanup 掉，模拟 StrictMode 的 mount → cleanup
    const staleAction = vi.fn();
    const disposeFirst = await initMainWindowListener(staleAction, vi.fn());
    disposeFirst();

    // 第二次挂载必须能重新拿到监听，否则独立窗口的 request_sync 无人接收
    const liveAction = vi.fn();
    const disposeSecond = await initMainWindowListener(liveAction, vi.fn());

    for (const handler of listeners.get(CHAT_ACTION_EVENT) ?? []) {
      handler({ payload: { type: 'request_sync' } });
    }

    expect(liveAction).toHaveBeenCalledWith({ type: 'request_sync' });
    expect(staleAction).not.toHaveBeenCalled();
    disposeSecond();
  });
});

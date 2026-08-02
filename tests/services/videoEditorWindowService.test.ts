import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  emitTo: vi.fn(async () => undefined),
  eventHandler: null as null | ((event: { payload: unknown }) => void),
  existingWindow: null as MockWindow | null,
  created: [] as MockWindow[],
  destroyHandlers: [] as (() => void)[],
}));

class MockWindow {
  label: string;
  options: Record<string, unknown>;
  show = vi.fn(async () => undefined);
  unminimize = vi.fn(async () => undefined);
  setFocus = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);

  constructor(label: string, options: Record<string, unknown> = {}) {
    this.label = label;
    this.options = options;
    tauriMocks.created.push(this);
  }

  static getByLabel = vi.fn(async () => tauriMocks.existingWindow);

  once(event: string, handler: (event: { payload?: unknown }) => void) {
    if (event === 'tauri://created') queueMicrotask(() => handler({}));
    if (event === 'tauri://destroyed') tauriMocks.destroyHandlers.push(() => handler({}));
    return Promise.resolve(() => undefined);
  }
}

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: MockWindow }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: tauriMocks.emitTo,
  listen: vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
    tauriMocks.eventHandler = handler;
    return () => { tauriMocks.eventHandler = null; };
  }),
}));

import {
  VIDEO_EDITOR_HOST_EVENT,
  VIDEO_EDITOR_MESSAGE_EVENT,
  VIDEO_EDITOR_WINDOW_LABEL,
  __resetVideoEditorWindowServiceForTests,
  buildVideoEditorWindowUrl,
  openVideoEditorWindow,
  parseVideoEditorWindowEnvelope,
  postVideoEditorExported,
  postVideoEditorFrameExported,
  subscribeVideoEditorWindow,
} from '../../src/services/videoEditorWindowService';

/** ensureMainListener 走动态 import + await listen，需要让出若干轮事件循环 */
async function flushListener(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('videoEditorWindowService', () => {
  beforeEach(() => {
    __resetVideoEditorWindowServiceForTests();
    tauriMocks.emitTo.mockClear();
    tauriMocks.eventHandler = null;
    tauriMocks.existingWindow = null;
    tauriMocks.created.length = 0;
    tauriMocks.destroyHandlers.length = 0;
    MockWindow.getByLabel.mockClear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __TAURI__: {},
        location: { origin: 'http://localhost:1420' },
        setTimeout,
        clearTimeout,
      },
    });
  });

  describe('buildVideoEditorWindowUrl', () => {
    it('routes to the shared entry with the session parameters', () => {
      const url = buildVideoEditorWindowUrl({
        instanceId: 'proj-1::node-7',
        projectId: 'proj-1',
        nodeId: 'node-7',
        theme: 'light',
      });

      expect(url.startsWith('index.html?')).toBe(true);
      const params = new URLSearchParams(url.slice('index.html?'.length));
      expect(params.get('view')).toBe('video-editor');
      expect(params.get('instanceId')).toBe('proj-1::node-7');
      expect(params.get('projectId')).toBe('proj-1');
      expect(params.get('nodeId')).toBe('node-7');
      expect(params.get('theme')).toBe('light');
    });
  });

  describe('parseVideoEditorWindowEnvelope', () => {
    it('accepts a well-formed envelope', () => {
      expect(parseVideoEditorWindowEnvelope({
        instanceId: 'proj::node',
        message: { type: 'storyai:video-editor-ready' },
      })).toEqual({
        instanceId: 'proj::node',
        message: { type: 'storyai:video-editor-ready' },
      });
    });

    it('accepts the current-frame export message', () => {
      expect(parseVideoEditorWindowEnvelope({
        instanceId: 'proj::node',
        message: {
          type: 'storyai:video-editor-frame-exported',
          payload: { imageUrl: 'asset://frame.png', fileName: 'frame.png', time: 1.5 },
        },
      })).toEqual({
        instanceId: 'proj::node',
        message: {
          type: 'storyai:video-editor-frame-exported',
          payload: { imageUrl: 'asset://frame.png', fileName: 'frame.png', time: 1.5 },
        },
      });
    });

    it('rejects message types outside the allow list', () => {
      expect(parseVideoEditorWindowEnvelope({
        instanceId: 'proj::node',
        message: { type: 'storyai:video-editor-evil' },
      })).toBeNull();
    });

    it('rejects malformed instance ids and payloads', () => {
      expect(parseVideoEditorWindowEnvelope({
        instanceId: '   ',
        message: { type: 'storyai:video-editor-ready' },
      })).toBeNull();
      expect(parseVideoEditorWindowEnvelope({
        instanceId: 'a'.repeat(129),
        message: { type: 'storyai:video-editor-ready' },
      })).toBeNull();
      expect(parseVideoEditorWindowEnvelope({
        instanceId: 'proj::node',
        message: { type: 'storyai:video-editor-exported', payload: 'nope' },
      })).toBeNull();
    });
  });

  it('creates one window carrying the editor route', async () => {
    await openVideoEditorWindow({
      instanceId: 'proj-1::node-7',
      projectId: 'proj-1',
      nodeId: 'node-7',
      theme: 'dark',
    });

    expect(tauriMocks.created).toHaveLength(1);
    expect(tauriMocks.created[0]?.label).toBe(VIDEO_EDITOR_WINDOW_LABEL);
    expect(String(tauriMocks.created[0]?.options.url)).toContain('view=video-editor');
    expect(String(tauriMocks.created[0]?.options.url)).toContain('nodeId=node-7');
    // 与资源搜索窗口一致的自绘标题栏外观
    expect(tauriMocks.created[0]?.options.decorations).toBe(false);
    expect(tauriMocks.created[0]?.options.transparent).toBe(true);
  });

  it('focuses the existing window and re-targets it instead of creating a second one', async () => {
    const existing = new MockWindow(VIDEO_EDITOR_WINDOW_LABEL);
    tauriMocks.created.length = 0;
    tauriMocks.existingWindow = existing;

    await openVideoEditorWindow({
      instanceId: 'proj-1::node-9',
      projectId: 'proj-1',
      nodeId: 'node-9',
    });

    expect(tauriMocks.created).toHaveLength(0);
    expect(existing.setFocus).toHaveBeenCalled();
    expect(tauriMocks.emitTo).toHaveBeenCalledWith(
      VIDEO_EDITOR_WINDOW_LABEL,
      VIDEO_EDITOR_HOST_EVENT,
      expect.objectContaining({
        instanceId: 'proj-1::node-9',
        message: expect.objectContaining({ type: 'storyai:video-editor-session' }),
      }),
    );
  });

  it('delivers export results only to the matching instance subscriber', async () => {
    const forNode7 = vi.fn();
    const forNode9 = vi.fn();
    subscribeVideoEditorWindow('proj-1::node-7', forNode7);
    subscribeVideoEditorWindow('proj-1::node-9', forNode9);
    await flushListener();

    tauriMocks.eventHandler?.({
      payload: {
        instanceId: 'proj-1::node-7',
        message: {
          type: 'storyai:video-editor-exported',
          payload: { videoUrl: 'asset://out.mp4', fileName: 'out.mp4', duration: 3 },
        },
      },
    });

    expect(forNode7).toHaveBeenCalledWith(expect.objectContaining({
      type: 'storyai:video-editor-exported',
    }));
    expect(forNode9).not.toHaveBeenCalled();
  });

  it('ignores envelopes whose message type is not allowed', async () => {
    const subscriber = vi.fn();
    subscribeVideoEditorWindow('proj-1::node-7', subscriber);
    await flushListener();

    tauriMocks.eventHandler?.({
      payload: {
        instanceId: 'proj-1::node-7',
        message: { type: 'storyai:video-editor-inject', payload: { videoUrl: 'x' } },
      },
    });

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('notifies subscribers when the window is destroyed', async () => {
    const subscriber = vi.fn();
    subscribeVideoEditorWindow('proj-1::node-7', subscriber);
    await openVideoEditorWindow({
      instanceId: 'proj-1::node-7',
      projectId: 'proj-1',
      nodeId: 'node-7',
    });

    tauriMocks.destroyHandlers.forEach((handler) => handler());

    expect(subscriber).toHaveBeenCalledWith({ type: 'storyai:video-editor-close' });
  });

  it('posts export results back to the main window', async () => {
    await postVideoEditorExported('proj-1::node-7', {
      videoUrl: 'asset://out.mp4',
      filePath: '/data/out.mp4',
      fileName: 'out.mp4',
      duration: 4.5,
    });

    expect(tauriMocks.emitTo).toHaveBeenCalledWith(
      'main',
      VIDEO_EDITOR_MESSAGE_EVENT,
      expect.objectContaining({
        instanceId: 'proj-1::node-7',
        message: expect.objectContaining({
          type: 'storyai:video-editor-exported',
          payload: expect.objectContaining({ videoUrl: 'asset://out.mp4', duration: 4.5 }),
        }),
      }),
    );
  });

  it('posts the exported current frame back to the main window', async () => {
    await postVideoEditorFrameExported('proj-1::node-7', {
      imageUrl: 'asset://frame.png',
      filePath: '/data/frame.png',
      fileName: 'frame.png',
      time: 2.25,
      width: 1920,
      height: 1080,
    });

    expect(tauriMocks.emitTo).toHaveBeenCalledWith(
      'main',
      VIDEO_EDITOR_MESSAGE_EVENT,
      expect.objectContaining({
        instanceId: 'proj-1::node-7',
        message: expect.objectContaining({
          type: 'storyai:video-editor-frame-exported',
          payload: expect.objectContaining({
            imageUrl: 'asset://frame.png',
            time: 2.25,
            width: 1920,
            height: 1080,
          }),
        }),
      }),
    );
  });
});

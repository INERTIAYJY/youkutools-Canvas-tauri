/**
 * comfyUISettings — 回归测试：ComfyUISettings memory controls。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import ComfyUISettings from '../../src/components/settings/ComfyUISettings';
import { useAppStore } from '../../src/store/useAppStore';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('ComfyUISettings memory controls', () => {
  it('shows manual release controls and keeps smart cache as the default policy', () => {
    const html = renderToStaticMarkup(<ComfyUISettings />);

    expect(html).toContain('ComfyUI 显存与缓存');
    expect(html).toContain('卸载模型');
    expect(html).toContain('完全释放');
    expect(html).toContain('保留智能缓存（推荐）');
    expect(useAppStore.getState().config.comfyMemoryPolicy).toBe('smart');
    expect(html).toContain('自动策略只对 localhost、127.0.0.1 或 ::1 生效');
  });
});

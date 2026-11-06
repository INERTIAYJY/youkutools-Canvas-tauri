/**
 * nativePerformanceModeService — 回归测试：native performance mode。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), relaunch: vi.fn(), close: vi.fn(), resume: vi.fn(), save: vi.fn(), project: vi.fn(),
  state: {
    configHydrated: true, config: { performanceMode: false }, currentProjectId: 'project',
    projectLoadStatus: 'ready', nodes: [] as unknown[], edges: [] as unknown[], autoSaveFailure: null as unknown,
    updateConfig: vi.fn(), saveConfig: vi.fn(), saveCurrentProjectSilent: vi.fn(),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../../src/services/configPersistenceQueue', () => ({ prepareSettingsClose: mocks.close, resumeSettingsPersistence: mocks.resume }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
  mocks.state = {
    configHydrated: true, config: { performanceMode: false }, currentProjectId: 'project', projectLoadStatus: 'ready',
    nodes: [], edges: [], autoSaveFailure: null,
    updateConfig: vi.fn((partial) => { mocks.state.config = { ...mocks.state.config, ...partial }; }),
    saveConfig: mocks.save, saveCurrentProjectSilent: mocks.project,
  };
  mocks.save.mockResolvedValue(undefined); mocks.project.mockResolvedValue('project');
  mocks.close.mockResolvedValue(true); mocks.relaunch.mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue({ supported: true, active: false, restartRequired: true });
});

async function fixture() {
  const service = await import('../../src/services/nativePerformanceModeService');
  const host = vi.fn(async (work: () => Promise<void>) => work());
  service.registerPerformanceRestartHost(host);
  return { ...service, host };
}

describe('native performance mode', () => {
  it('saves settings and project before relaunch and persists a fixed boolean IPC', async () => {
    const f = await fixture(); await f.applyNativePerformanceMode(true);
    expect(mocks.state.config.performanceMode).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith({ silent: true, throwOnError: true });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'sync_native_performance_mode', { enabled: true });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'sync_native_performance_mode', { enabled: true });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.project.mock.invocationCallOrder[0]);
    expect(mocks.project.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[1]);
    expect(mocks.invoke.mock.invocationCallOrder[1]).toBeLessThan(mocks.relaunch.mock.invocationCallOrder[0]);
    expect(mocks.relaunch).toHaveBeenCalledOnce(); expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it('migrates an already enabled frontend once and does not restart again when native mode matches', async () => {
    const f = await fixture(); mocks.state.config.performanceMode = true;
    await f.applyNativePerformanceMode();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    mocks.invoke.mockResolvedValue({ supported: true, active: true, restartRequired: false });
    await f.applyNativePerformanceMode();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.state.updateConfig).not.toHaveBeenCalled();
  });

  it('writes disable for next launch without restarting or saving the project', async () => {
    const f = await fixture(); mocks.state.config.performanceMode = true;
    await f.applyNativePerformanceMode(false);
    expect(mocks.invoke).toHaveBeenCalledWith('sync_native_performance_mode', { enabled: false });
    expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.project).not.toHaveBeenCalled();
  });

  it('does not restart a normal-mode startup', async () => {
    const f = await fixture();
    mocks.invoke.mockResolvedValue({ supported: true, active: false, restartRequired: false });
    await f.applyNativePerformanceMode();
    expect(f.host).not.toHaveBeenCalled(); expect(mocks.state.updateConfig).not.toHaveBeenCalled();
  });

  it.each(['browser', 'macOS', 'Linux'])('retains frontend-only mode on %s', async (platform) => {
    if (platform === 'browser') vi.stubGlobal('window', {});
    else vi.stubGlobal('navigator', { userAgent: platform });
    const f = await fixture(); await f.applyNativePerformanceMode();
    expect(mocks.save).not.toHaveBeenCalled();
    await f.applyNativePerformanceMode(true);
    expect(mocks.state.config.performanceMode).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it('refuses to persist defaults before configuration hydration', async () => {
    const f = await fixture(); mocks.state.configHydrated = false;
    await expect(f.applyNativePerformanceMode(true)).rejects.toThrow('尚未加载');
    expect(mocks.state.updateConfig).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(['settings', 'native', 'pending-settings', 'project', 'loading', 'changed', 'restart'])('stays open on %s failure and permits an explicit retry', async (stage) => {
    const f = await fixture();
    if (stage === 'settings') mocks.save.mockRejectedValueOnce(new Error('private detail'));
    if (stage === 'native') mocks.invoke.mockRejectedValueOnce(new Error('private detail'));
    if (stage === 'pending-settings') mocks.close.mockResolvedValueOnce(false);
    if (stage === 'project') mocks.project.mockResolvedValueOnce(undefined);
    if (stage === 'loading') mocks.state.projectLoadStatus = 'loading';
    if (stage === 'changed') mocks.project.mockImplementationOnce(async () => {
      mocks.state = { ...mocks.state, nodes: [{}] }; return 'project';
    });
    if (stage === 'restart') mocks.relaunch.mockRejectedValueOnce(new Error('private detail'));
    await expect(f.applyNativePerformanceMode(true)).rejects.not.toThrow('private detail');
    expect(mocks.relaunch).toHaveBeenCalledTimes(stage === 'restart' ? 1 : 0);
    if (['pending-settings', 'project', 'loading', 'changed', 'restart'].includes(stage)) expect(mocks.resume).toHaveBeenCalledOnce();
    mocks.state.projectLoadStatus = 'ready';
    await f.applyNativePerformanceMode(true);
    expect(mocks.relaunch).toHaveBeenCalledTimes(stage === 'restart' ? 2 : 1);
  });

  it('coalesces repeated activation while a save is pending', async () => {
    const f = await fixture(); let release!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = f.applyNativePerformanceMode(true);
    const second = f.applyNativePerformanceMode(true);
    expect(first).toBe(second); release(); await first;
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it('does not restart after the mode was changed while native synchronization was pending', async () => {
    const f = await fixture();
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.state.config.performanceMode = false;
      return { supported: true, active: false, restartRequired: true };
    });
    await f.applyNativePerformanceMode(true);
    expect(f.host).not.toHaveBeenCalled();
  });

  it('does not lose an explicit activation arriving during passive startup sync', async () => {
    const f = await fixture(); let release!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    mocks.invoke.mockResolvedValueOnce({ supported: true, active: false, restartRequired: false });
    const startup = f.applyNativePerformanceMode();
    const enable = f.applyNativePerformanceMode(true);
    release(); await startup; await enable;
    expect(mocks.state.config.performanceMode).toBe(true);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it('sanitizes an unexpected project save rejection and leaves the window open', async () => {
    const f = await fixture(); mocks.project.mockRejectedValueOnce(new Error('private file path'));
    await expect(f.applyNativePerformanceMode(true)).rejects.toThrow('项目保存未完成');
    expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.resume).toHaveBeenCalledOnce();
  });
});

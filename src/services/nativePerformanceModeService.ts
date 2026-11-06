/**
 * nativePerformanceModeService — 同步原生性能模式并处理重启请求。
 */
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { prepareSettingsClose, resumeSettingsPersistence } from './configPersistenceQueue';

type RestartHost = (work: () => Promise<void>) => Promise<void>;
let restartHost: RestartHost | undefined;
let pending: Promise<void> | undefined;
let pendingMode: boolean | undefined;

interface NativeStatus { supported: boolean; active: boolean; restartRequired: boolean }

/** 主窗口提供与关闭流程共用的互斥锁、输入遮罩；服务负责保存及重启顺序。 */
export function registerPerformanceRestartHost(host: RestartHost): () => void {
  restartHost = host;
  return () => { if (restartHost === host) restartHost = undefined; };
}

export function isNativePerformanceModeSupported(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}

async function syncNative(enabled: boolean): Promise<NativeStatus> {
  try { return await invoke<NativeStatus>('sync_native_performance_mode', { enabled }); }
  catch { throw new Error('图形启动设置保存失败，未重启'); }
}

async function restartSafely(): Promise<void> {
  try {
    if (!await prepareSettingsClose(true)) throw new Error('设置尚未保存，已取消自动重启');
    const state = useAppStore.getState();
    const projectId = state.currentProjectId;
    if (state.projectLoadStatus !== 'ready') throw new Error('项目尚未就绪，已取消自动重启');
    let savedId: string | undefined;
    try { savedId = await state.saveCurrentProjectSilent(); }
    catch { throw new Error('项目保存未完成，已取消自动重启'); }
    const latest = useAppStore.getState();
    if ((projectId && savedId !== projectId) || (!projectId && state.nodes.length > 0 && !savedId)
      || latest.autoSaveFailure || latest.currentProjectId !== projectId
      || latest.nodes !== state.nodes || latest.edges !== state.edges) {
      throw new Error('项目保存未完成，已取消自动重启');
    }
    if (!latest.config.performanceMode) throw new Error('性能模式已变更，已取消自动重启');
    // 收集防抖设置后再次同步，确保原生启动开关与最终保存的配置一致。
    await syncNative(true);
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch { throw new Error('自动重启失败，请手动退出并重新打开应用'); }
  } finally {
    resumeSettingsPersistence();
  }
}

/** 未传参数用于升级后的启动同步；不写默认值，不在模块加载时触发重启。 */
export function applyNativePerformanceMode(enabled?: boolean): Promise<void> {
  if (pending) {
    if (enabled === undefined || enabled === pendingMode) return pending;
    // 被动启动同步不能吞掉随后明确的开关操作。
    return pending.catch(() => {}).then(() => applyNativePerformanceMode(enabled));
  }
  const run = async () => {
    if (enabled === undefined && !isNativePerformanceModeSupported()) return;
    const state = useAppStore.getState();
    if (!state.configHydrated) throw new Error('设置尚未加载，暂时无法切换性能模式');
    if (enabled !== undefined) state.updateConfig({ performanceMode: enabled });
    try { await useAppStore.getState().saveConfig({ silent: true, throwOnError: true }); }
    catch { throw new Error('设置尚未保存，已取消自动重启'); }
    if (!isNativePerformanceModeSupported()) return;
    const desired = useAppStore.getState().config.performanceMode === true;
    const status = await syncNative(desired);
    if ((useAppStore.getState().config.performanceMode === true) !== desired) return;
    if (status.supported && (status.restartRequired || enabled === true) && desired) {
      if (!restartHost) throw new Error('主窗口尚未就绪，已取消自动重启');
      await restartHost(restartSafely);
    }
  };
  pendingMode = enabled;
  pending = run().finally(() => { pending = undefined; pendingMode = undefined; });
  return pending;
}

/** 固定比较 Worker，完成即释放；不接收代码，不回退主线程比较大型画布。 */
import type { ProjectExchangeSnapshot } from '../types/projectExchange';
import type { ProjectMergePlan } from './projectMergeService';
import type { ProjectSaveData } from './storageService';
import type { ProjectExchangeState } from '../types/projectExchange';
import type { ArchiveAssetDigest, ExchangeCapture } from './projectExchangeDomain';
function run<T>(payload: unknown): Promise<T> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('无法启动项目比较后台任务，请重启应用'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./projectMergeWorker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (result?: T, error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(undefined, new Error('项目比较超时，请缩小项目后重试')), 60_000);
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      if (event.data.result) finish(event.data.result);
      else finish(undefined, new Error(event.data.error ?? '项目比较失败'));
    };
    worker.onerror = (event) => { event.preventDefault(); finish(undefined, new Error('项目比较后台任务异常')); };
    worker.onmessageerror = () => finish(undefined, new Error('无法读取项目比较结果'));
    try { worker.postMessage(payload); } catch { finish(undefined, new Error('无法发送项目比较材料')); }
  });
}
export function compareProjectSnapshots(base: ProjectExchangeSnapshot | null, local: ProjectExchangeSnapshot, incoming: ProjectExchangeSnapshot): Promise<ProjectMergePlan> {
  return run({ operation: 'compare', base, local, incoming });
}
export function captureProjectSnapshot(records: readonly ProjectSaveData[], assets: readonly ArchiveAssetDigest[], state: ProjectExchangeState | null,
  previousSnapshot?: ProjectExchangeSnapshot, projectDirectory?: string): Promise<ExchangeCapture> {
  return run({ operation: 'capture', records, assets, state, previousSnapshot, projectDirectory });
}

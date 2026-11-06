/** 固定业务比较入口，无网络、无文件读写、无生成或插件执行。 */
import { buildProjectMergePlan } from './projectMergeService';
import { captureExchangeSnapshot, validateExchangeDomain, type ArchiveAssetDigest } from './projectExchangeDomain';
import type { ProjectExchangeSnapshot, ProjectExchangeState } from '../types/projectExchange';
import type { ProjectSaveData } from './storageService';
type Request = { operation: 'compare'; base: ProjectExchangeSnapshot | null; local: ProjectExchangeSnapshot; incoming: ProjectExchangeSnapshot }
  | { operation: 'capture'; records: ProjectSaveData[]; assets: ArchiveAssetDigest[]; state: ProjectExchangeState | null; previousSnapshot?: ProjectExchangeSnapshot; projectDirectory?: string };
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    if (event.data.operation === 'capture') {
      const { records, assets, state, previousSnapshot, projectDirectory } = event.data;
      self.postMessage({ result: captureExchangeSnapshot(records, assets, state, previousSnapshot, projectDirectory) }); return;
    }
    const { base, local, incoming } = event.data;
    self.postMessage({ result: buildProjectMergePlan(base ? validateExchangeDomain(base) : null, validateExchangeDomain(local), validateExchangeDomain(incoming)) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '项目比较失败' }); }
};

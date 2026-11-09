/**
 * 森之灵目录能力自愈。
 *
 * `config.providers.seedling` 里的 `videoCapability` 是「拉取目录那一刻」的快照：
 * 早期版本把视频时长写死成 4~15 秒，旧快照不会随升级自动更新；用户取消勾选模型后
 * `selectedModels` 也可能不再包含节点正在用的模型。两种情况都会让画布退回
 * 2~15 秒 / 480p-4K 的通用默认值（例如 高质量模型2.5 在目录里其实是 30 秒）。
 *
 * 这里按 CLI `models list` 重新计算能力，只替换 `videoCapability`，保留用户的
 * 选择与顺序；没有实际变化时不写配置。失败（CLI 缺失、未联网）时静默跳过。
 */
import type { ProviderModelSelection } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { fetchSeedlingModels } from '../seedlingService';
import { buildSeedlingCatalogModels } from './providerCatalogService';

let inflight: Promise<boolean> | null = null;

/** 并发调用合并为一次 CLI 请求。 */
export function refreshSeedlingModelCapabilities(): Promise<boolean> {
  inflight ??= runRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function runRefresh(): Promise<boolean> {
  const store = useAppStore.getState();
  const provider = store.config.providers?.seedling;
  if (!provider) return false;

  const payload = await fetchSeedlingModels();
  const freshModels = buildSeedlingCatalogModels(payload.models ?? []);
  if (freshModels.length === 0) return false;

  const capabilityById = new Map(
    freshModels.map((model) => [normalizeModelId(model.id), model.videoCapability]),
  );
  const apply = (models: readonly ProviderModelSelection[] | undefined) => models?.map((model) => {
    const capability = capabilityById.get(normalizeModelId(model.id));
    if (!capability || JSON.stringify(capability) === JSON.stringify(model.videoCapability)) {
      return model;
    }
    return { ...model, videoCapability: capability };
  });

  const selectedModels = apply(provider.selectedModels);
  const catalogModels = apply(provider.catalogModels) ?? freshModels;
  const changed = JSON.stringify(selectedModels) !== JSON.stringify(provider.selectedModels)
    || JSON.stringify(catalogModels) !== JSON.stringify(provider.catalogModels);
  if (!changed) return false;

  store.setProviderConfig('seedling', { selectedModels, catalogModels });
  await store.saveConfig({ silent: true });
  return true;
}

function normalizeModelId(id: string): string {
  return id.trim().replace(/^seedling\//i, '').toLowerCase();
}

/**
 * OnnxModelStorageManager — 提供本地 ONNX 模型存储管理界面与交互。
 */
import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useAppStore } from '../../store/useAppStore';
import { listStoredOnnxModels, removeStoredOnnxModel, type StoredOnnxModel } from '../../services/onnxService';
import { formatBytes } from '../../services/storageQuota';
import { useT } from '../../i18n';

const MODEL_LABELS: Record<string, string> = {
  'realesrgan-x4.onnx': '图片超分 · Real-ESRGAN',
  'rmbg-1.4.onnx': '主体识别 · RMBG-1.4',
  'sensevoice-small-int8.onnx': '语音转文本 · SenseVoice',
  'sensevoice-vocab.txt': '语音转文本词表 · SenseVoice',
};

export default function OnnxModelStorageManager() {
  const t = useT();
  const showToast = useAppStore((state) => state.showToast);
  const available = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [models, setModels] = useState<StoredOnnxModel[]>([]);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void listStoredOnnxModels()
      .then((items) => { if (active) setModels(items); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [available, showToast]);

  const handleRemove = async (modelName: string) => {
    setRemoving(modelName);
    try {
      await removeStoredOnnxModel(modelName);
      setModels((current) => current.filter((model) => model.name !== modelName));
      setConfirming(null);
      setModels(await listStoredOnnxModels());
      showToast(t('已删除 ONNX 模型文件'), 'success');
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : String(reason), 'error');
    } finally {
      setRemoving(null);
    }
  };

  const totalBytes = models.reduce((sum, model) => sum + model.size_bytes, 0);

  return (
    <section className="mt-5 border-t border-canvas-border pt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-canvas-text">{t('本地 ONNX 模型')}</h3>
          <p className="mt-1 text-xs text-canvas-text-muted">
            {t('按需下载的模型由相关节点共用；删除后下次使用需要重新下载。')}
          </p>
        </div>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-400">
          <Icon icon="lucide:brain" width="18" height="18" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-canvas-text-secondary">
          {!available ? t('仅桌面版可查看本地模型') : error ?? (loading ? t('正在读取...') : t('共 {count} 个文件，占用 {size}', { count: models.length, size: formatBytes(totalBytes) }))}
        </p>
        {available && !error && !loading && models.length === 0 && (
          <div className="rounded-lg border border-canvas-border bg-canvas-card p-3 text-xs text-canvas-text-muted">
            {t('暂无已下载的 ONNX 模型')}
          </div>
        )}
        {models.map((model) => (
          <div key={model.name} className="flex items-center justify-between gap-3 rounded-lg border border-canvas-border bg-canvas-card p-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-canvas-text">{t(MODEL_LABELS[model.name] ?? model.name)}</p>
              <p className="mt-1 text-[11px] text-canvas-text-muted">{model.name} · {formatBytes(model.size_bytes)}</p>
            </div>
            {confirming === model.name ? (
              <div className="flex shrink-0 gap-2">
                <button type="button" className="rounded-lg bg-canvas-hover px-2.5 py-1.5 text-xs text-canvas-text-secondary hover:bg-canvas-border" onClick={() => setConfirming(null)} disabled={removing !== null}>
                  {t('取消')}
                </button>
                <button type="button" className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/25 disabled:opacity-50" onClick={() => { void handleRemove(model.name); }} disabled={removing !== null}>
                  {removing === model.name ? t('正在删除...') : t('确认删除')}
                </button>
              </div>
            ) : (
              <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-canvas-hover px-2.5 py-1.5 text-xs text-canvas-text-secondary hover:bg-canvas-border" onClick={() => setConfirming(model.name)} disabled={removing !== null}>
                <Icon icon="lucide:trash-2" width="13" height="13" />
                {t('删除资源')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

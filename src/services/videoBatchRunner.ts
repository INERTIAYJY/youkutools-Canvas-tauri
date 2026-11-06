/**
 * videoBatchRunner — 执行视频批次并恢复中断后的任务状态。
 */
import type { VideoBatch, VideoBatchItem, VideoPreflightItem } from '../types/videoBatch';

export interface VideoBatchRunnerPorts {
  projectId: () => string | null;
  read: () => VideoBatch;
  update: (nodeId: string, patch: Partial<VideoBatchItem>) => Promise<void>;
  inspect: (nodeId: string) => VideoPreflightItem | null;
  execute: (nodeId: string) => Promise<{ success: boolean; message?: string }>;
}

/** One-at-a-time execution; durable running state precedes submission. No implicit retry. */
export async function runVideoBatch(ports: VideoBatchRunnerPorts): Promise<void> {
  const batch = ports.read();
  for (const original of batch.items) {
    const item = ports.read().items.find((i) => i.nodeId === original.nodeId);
    if (!item || item.status !== 'waiting') continue;
    if (ports.projectId() !== batch.projectId) {
      await ports.update(item.nodeId, { status: 'cancelled', message: '项目已切换，未提交' });
      continue;
    }
    const current = ports.inspect(item.nodeId);
    if (!current || current.issues.length || current.fingerprint !== item.fingerprint) {
      await ports.update(item.nodeId, { status: 'error', message: !current ? '节点已删除'
        : current.issues.length ? current.issues.join('；') : '输入已变化，请重新检查后提交' });
      continue;
    }
    await ports.update(item.nodeId, { status: 'running', message: undefined });
    if (ports.projectId() !== batch.projectId) {
      await ports.update(item.nodeId, { status: 'cancelled', message: '项目已切换，未提交' });
      continue;
    }
    try {
      const result = await ports.execute(item.nodeId);
      const uncertain = /取消|画布已变化/.test(result.message || '');
      await ports.update(item.nodeId, ports.projectId() !== batch.projectId
        ? { status: 'unknown', message: '项目已切换，请核对原任务和输出，勿直接重投' }
        : { status: result.success ? 'success' : uncertain ? 'unknown' : 'error',
          message: result.success ? undefined : uncertain ? '生成状态未确认，请检查服务与节点结果' : '生成失败，请定位视频节点查看原因' });
    } catch {
      // A transport/persistence exception may occur after submission; fail closed on retries.
      await ports.update(item.nodeId, { status: 'unknown', message: '执行状态未确认，请核对输出后再决定是否重生成' });
    }
  }
}

export function recoverVideoBatches(batches: VideoBatch[]): VideoBatch[] {
  return batches.map((b) => ({ ...b, items: b.items.map((i) => i.status === 'running'
    ? { ...i, status: 'unknown', message: '上次执行被中断，请先核对服务与结果' }
    : i.status === 'waiting' ? { ...i, status: 'cancelled', message: '重开后未自动提交，可重新检查' } : i) }));
}

/**
 * videoBatchRunner — 回归测试：waits for each execution and its durable status update, continuing after failure。
 */
import { it, expect, vi } from 'vitest';
import { runVideoBatch, recoverVideoBatches, type VideoBatchRunnerPorts } from '../../src/services/videoBatchRunner';
import type { VideoBatch } from '../../src/types/videoBatch';

function setup() {
  const batch: VideoBatch = { id: 'b', projectId: 'p', createdAt: 1, items: ['a', 'b', 'c'].map((nodeId) => ({ nodeId, label: nodeId, status: 'waiting', fingerprint: 'f' })) };
  const ports: VideoBatchRunnerPorts = {
    projectId: () => 'p', read: () => batch,
    update: async (id, patch) => { Object.assign(batch.items.find((i) => i.nodeId === id)!, patch); },
    inspect: (nodeId) => ({ nodeId, label: nodeId, fingerprint: 'f', issues: [], existing: false, stale: false }),
    execute: vi.fn(async () => ({ success: true })),
  };
  return { batch, ports };
}
it('waits for each execution and its durable status update, continuing after failure', async () => {
  const { batch, ports } = setup();
  const order: string[] = [];
  ports.execute = vi.fn(async (id) => {
    expect(batch.items.filter((i) => i.status === 'running')).toHaveLength(1);
    order.push(id); await new Promise((resolve) => setTimeout(resolve, 2));
    return { success: id !== 'b', message: id === 'b' ? '失败' : undefined };
  });
  await runVideoBatch(ports);
  expect(order).toEqual(['a', 'b', 'c']);
  expect(batch.items.map((i) => i.status)).toEqual(['success', 'error', 'success']);
});
it('does not submit cancelled items and stops scheduling when the project changes', async () => {
  const { batch, ports } = setup();
  batch.items[1].status = 'cancelled';
  ports.execute = vi.fn(async () => { ports.projectId = () => 'other'; return { success: true }; });
  await runVideoBatch(ports);
  expect(ports.execute).toHaveBeenCalledTimes(1);
  expect(batch.items.map((i) => i.status)).toEqual(['unknown', 'cancelled', 'cancelled']);
});
it('refuses changed inputs and missing nodes before submitting', async () => {
  const { batch, ports } = setup();
  ports.inspect = (id) => id === 'b' ? null : { nodeId: id, label: id, fingerprint: 'changed', issues: [], existing: false, stale: false };
  await runVideoBatch(ports);
  expect(ports.execute).not.toHaveBeenCalled();
  expect(batch.items.every((i) => i.status === 'error')).toBe(true);
});
it('fails closed when running state cannot persist and does not auto retry uncertain work', async () => {
  const { batch, ports } = setup();
  ports.update = vi.fn(async () => { throw new Error('storage full'); });
  await expect(runVideoBatch(ports)).rejects.toThrow('storage full');
  expect(ports.execute).not.toHaveBeenCalled();
  batch.items[0].status = 'running';
  const recovered = recoverVideoBatches([batch])[0];
  expect(recovered.items.map((i) => i.status)).toEqual(['unknown', 'cancelled', 'cancelled']);
  expect(batch.items[0].status).toBe('running');
});
it('classifies uncertain exceptions as needing review instead of retryable failure', async () => {
  const { batch, ports } = setup();
  ports.execute = vi.fn(async () => { throw new Error('unknown submit response'); });
  await runVideoBatch(ports);
  expect(batch.items.every((i) => i.status === 'unknown')).toBe(true);
});

/**
 * videoBatchRepository — 回归测试：persists isolated project queues, bounds history and removes records with a project。
 */
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import type { VideoBatch } from '../../src/types/videoBatch';

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  vi.resetModules();
});

it('persists isolated project queues, bounds history and removes records with a project', async () => {
  const { readVideoBatches, writeVideoBatches } = await import('../../src/services/videoBatchRepository');
  const batch = (projectId: string, n: number): VideoBatch => ({ id: `batch-${n}`, projectId, createdAt: n,
    items: [{ nodeId: 'video', label: 'SH001', fingerprint: 'digest', duration: 9, status: 'waiting' }] });
  expect(await readVideoBatches('a')).toEqual([]);
  await writeVideoBatches('a', Array.from({ length: 32 }, (_, n) => batch('a', n)));
  await writeVideoBatches('b', [batch('b', 0)]);
  const saved = await readVideoBatches('a');
  expect(saved).toHaveLength(30);
  expect(saved[0].id).toBe('batch-2');
  expect((await readVideoBatches('b'))[0].projectId).toBe('b');
  const { deleteProjectFromDb } = await import('../../src/services/indexedDbService');
  await deleteProjectFromDb('a');
  expect(await readVideoBatches('a')).toEqual([]);
  expect(await readVideoBatches('b')).toHaveLength(1);
});

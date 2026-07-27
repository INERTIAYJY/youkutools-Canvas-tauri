import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 端到端钉住报告里的那条路径：配置写进 IndexedDB 时不得含明文 API Key。
 * 这里用 fake-indexeddb 跑真实的 saveConfigToDb / loadConfigFromDb。
 */
const secretStore = vi.hoisted(() => ({
  isTauri: true,
  entries: new Map<string, string>(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: secretStore.invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async () => false) }));
vi.mock('../../src/services/fs/core', () => ({
  isTauriEnv: () => secretStore.isTauri,
  getProjectDataDir: vi.fn(async () => null),
  joinPath: (...parts: string[]) => parts.join('/'),
  listDirectoryFiles: vi.fn(async () => []),
  getAssetUrlFromPath: vi.fn(async (path: string) => `asset://${path}`),
}));
vi.mock('../../src/services/fs/assetIndex', () => ({
  identifyAsset: vi.fn(async () => null),
  resolveIndexedAssetPath: vi.fn(async () => null),
}));

import { loadConfigWithSecrets, saveConfig } from '../../src/services/storageService';
import { loadConfigFromDb, saveConfigToDb } from '../../src/services/indexedDbService';

beforeEach(() => {
  secretStore.isTauri = true;
  secretStore.entries.clear();
  secretStore.invoke.mockReset();
  secretStore.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    const key = args?.key as string;
    if (command === 'secret_set') { secretStore.entries.set(key, args.value as string); return undefined; }
    if (command === 'secret_get') return secretStore.entries.get(key) ?? null;
    if (command === 'secret_delete') { secretStore.entries.delete(key); return undefined; }
    return undefined;
  });
});

describe('config persistence keeps secrets out of IndexedDB', () => {
  it('stores only a keychain reference, and rehydrates the key on load', async () => {
    await saveConfig({
      theme: 'dark',
      providers: { apimart: { name: 'Apimart', apiKey: 'sk-should-not-persist' } },
    });

    const stored = await loadConfigFromDb();
    expect(JSON.stringify(stored)).not.toContain('sk-should-not-persist');
    expect(secretStore.entries.get('provider/apimart')).toBe('sk-should-not-persist');

    const { config, missingSecrets } = await loadConfigWithSecrets();
    expect(missingSecrets).toEqual([]);
    const providers = (config as { providers: Record<string, { apiKey: string }> }).providers;
    expect(providers.apimart.apiKey).toBe('sk-should-not-persist');
  });

  it('scrubs a legacy plaintext record from the database on first load', async () => {
    // 模拟本次修复之前落盘的记录
    await saveConfigToDb({
      theme: 'dark',
      providers: { volcengine: { name: '火山', apiKey: 'legacy-plaintext' } },
    });
    expect(JSON.stringify(await loadConfigFromDb())).toContain('legacy-plaintext');

    const { config } = await loadConfigWithSecrets();

    // 明文进凭据存储，数据库记录被立刻覆盖
    expect(secretStore.entries.get('provider/volcengine')).toBe('legacy-plaintext');
    expect(JSON.stringify(await loadConfigFromDb())).not.toContain('legacy-plaintext');
    const providers = (config as { providers: Record<string, { apiKey: string }> }).providers;
    expect(providers.volcengine.apiKey).toBe('legacy-plaintext');
  });

  it('still refuses to persist plaintext when no keychain is available', async () => {
    secretStore.isTauri = false;

    const unstored = await saveConfig({
      theme: 'dark',
      providers: { apimart: { name: 'Apimart', apiKey: 'sk-should-not-persist' } },
    });

    expect(unstored).toEqual(['apimart']);
    expect(JSON.stringify(await loadConfigFromDb())).not.toContain('sk-should-not-persist');
  });
});

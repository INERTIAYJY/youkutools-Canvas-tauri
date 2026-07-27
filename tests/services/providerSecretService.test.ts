import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  isTauri: true,
  keychain: new Map<string, string>(),
  failWrites: false,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock('../../src/services/fs/core', () => ({
  isTauriEnv: () => tauriMocks.isTauri,
}));

import {
  deleteProviderSecret,
  hasPlaintextSecret,
  providerSecretRef,
  restoreConfigSecrets,
  stripConfigSecrets,
} from '../../src/services/providerSecretService';

function config(providers: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { theme: 'dark', providers, ...extra };
}

beforeEach(() => {
  tauriMocks.isTauri = true;
  tauriMocks.keychain.clear();
  tauriMocks.failWrites = false;
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    const key = args?.key as string;
    if (command === 'secret_set') {
      if (tauriMocks.failWrites) throw new Error('凭据存储不可用');
      tauriMocks.keychain.set(key, args.value as string);
      return undefined;
    }
    if (command === 'secret_get') return tauriMocks.keychain.get(key) ?? null;
    if (command === 'secret_delete') {
      tauriMocks.keychain.delete(key);
      return undefined;
    }
    throw new Error(`unexpected command ${command}`);
  });
});

describe('provider secret persistence', () => {
  it('moves the api key into the keychain and leaves only a reference', async () => {
    const { config: persisted, unstored } = await stripConfigSecrets(
      config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret', baseUrl: 'https://api' } }),
    );

    expect(unstored).toEqual([]);
    expect(hasPlaintextSecret(persisted)).toBe(false);
    expect(JSON.stringify(persisted)).not.toContain('sk-live-secret');
    const providers = (persisted as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.apimart).toMatchObject({
      name: 'Apimart',
      apiKey: '',
      apiKeyRef: providerSecretRef('apimart'),
      baseUrl: 'https://api',
    });
    expect(tauriMocks.keychain.get('provider/apimart')).toBe('sk-live-secret');
  });

  it('restores the key from the keychain on load', async () => {
    const { config: persisted } = await stripConfigSecrets(
      config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret' } }),
    );

    const restored = await restoreConfigSecrets(persisted);

    expect(restored.missing).toEqual([]);
    expect(restored.migrated).toBe(false);
    const providers = (restored.config as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.apimart.apiKey).toBe('sk-live-secret');
  });

  it('migrates a legacy plaintext config into the keychain', async () => {
    const legacy = config({ volcengine: { name: '火山', apiKey: 'legacy-plain-key' } });

    const restored = await restoreConfigSecrets(legacy);

    expect(restored.migrated).toBe(true);
    expect(tauriMocks.keychain.get('provider/volcengine')).toBe('legacy-plain-key');
    // 迁移后内存里仍可用，但再次持久化不会写回明文
    const providers = (restored.config as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.volcengine.apiKey).toBe('legacy-plain-key');
    const { config: rewritten } = await stripConfigSecrets(restored.config);
    expect(hasPlaintextSecret(rewritten)).toBe(false);
    expect(JSON.stringify(rewritten)).not.toContain('legacy-plain-key');
  });

  it('never writes plaintext when the keychain rejects the write', async () => {
    tauriMocks.failWrites = true;

    const { config: persisted, unstored } = await stripConfigSecrets(
      config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret' } }),
    );

    expect(unstored).toEqual(['apimart']);
    expect(hasPlaintextSecret(persisted)).toBe(false);
    expect(JSON.stringify(persisted)).not.toContain('sk-live-secret');
    const providers = (persisted as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.apimart).not.toHaveProperty('apiKeyRef');
  });

  it('never writes plaintext outside Tauri either', async () => {
    tauriMocks.isTauri = false;

    const { config: persisted, unstored } = await stripConfigSecrets(
      config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret' } }),
    );

    expect(unstored).toEqual(['apimart']);
    expect(JSON.stringify(persisted)).not.toContain('sk-live-secret');
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it('reports connections whose keychain entry disappeared', async () => {
    const { config: persisted } = await stripConfigSecrets(
      config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret' } }),
    );
    tauriMocks.keychain.clear();

    const restored = await restoreConfigSecrets(persisted);

    expect(restored.missing).toEqual(['apimart']);
    const providers = (restored.config as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.apimart.apiKey).toBe('');
  });

  it('drops the deprecated dreamina cookie instead of persisting it', async () => {
    const { config: persisted } = await stripConfigSecrets(
      config({}, { dreaminaAuth: { loggedIn: true, username: 'u', cookie: 'sessionid=secret' } }),
    );

    expect(JSON.stringify(persisted)).not.toContain('sessionid=secret');
    const auth = (persisted as { dreaminaAuth: Record<string, unknown> }).dreaminaAuth;
    expect(auth).toEqual({ loggedIn: true, username: 'u' });
  });

  it('keeps empty connections and non-provider config untouched', async () => {
    const { config: persisted, unstored } = await stripConfigSecrets(
      config({ custom: { name: '自建', apiKey: '', catalogId: 'custom-openai' } }, { theme: 'light' }),
    );

    expect(unstored).toEqual([]);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({ theme: 'light' });
    const providers = (persisted as { providers: Record<string, Record<string, unknown>> }).providers;
    expect(providers.custom).toMatchObject({ apiKey: '', catalogId: 'custom-openai' });
  });

  it('deletes the keychain entry when a connection is removed', async () => {
    await stripConfigSecrets(config({ apimart: { name: 'Apimart', apiKey: 'sk-live-secret' } }));
    expect(tauriMocks.keychain.has('provider/apimart')).toBe(true);

    await deleteProviderSecret('apimart');

    expect(tauriMocks.keychain.has('provider/apimart')).toBe(false);
  });

  it('sanitizes connection ids used as keychain entry names', () => {
    expect(providerSecretRef('custom openai/../x')).toBe('secret:provider/custom_openai___x');
  });
});

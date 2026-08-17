/**
 * SeedlingSettings — 森之灵（Seedling）CLI 连接设置
 *
 * 双认证方式：
 *   A. CLI 浏览器授权登录（seedling auth login）：登录态由 CLI 配置文件持久化，
 *      本页展示授权链接/配对码并镜像登录状态到 config.seedlingAuth；
 *   B. API Token（机器令牌）：写入 config.providers.seedling.apiKey，
 *      持久化时由 providerSecretService 摘进 Rust secret_store。
 *
 * 同时展示 CLI 检测状态（found / version / source）与可用模型列表。
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { SeedlingAuthLoginRuntime, SeedlingCliStatus, SeedlingModelInfo } from '../../services/seedlingService';
import {
  cancelSeedlingAuthLogin,
  fetchSeedlingCliStatus,
  fetchSeedlingModels,
  getSeedlingAuthLoginRuntime,
  logoutSeedling,
  startSeedlingAuthLogin,
} from '../../services/seedlingService';
import { buildSeedlingCatalogModels } from '../../services/ai/providerCatalogService';

const AUTH_EVENT = 'seedling-login-runtime';

export default function SeedlingSettings() {
  const setProviderKey = useAppStore((state) => state.setProviderKey);
  const updateConfig = useAppStore((state) => state.updateConfig);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const config = useAppStore((state) => state.config);

  const [cliStatus, setCliStatus] = useState<SeedlingCliStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [models, setModels] = useState<SeedlingModelInfo[]>([]);
  const [apiToken, setApiToken] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenSavedMsg, setTokenSavedMsg] = useState('');

  const [loginRuntime, setLoginRuntime] = useState<SeedlingAuthLoginRuntime | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const authMirror = config.seedlingAuth;
  const savedToken = config.providers?.seedling?.apiKey ?? '';

  const loadModels = useCallback(async () => {
    try {
      const payload = await fetchSeedlingModels();
      setModels(payload.models ?? []);
    } catch {
      setModels([]);
    }
  }, []);

  /**
   * 认证成功后自动拉取模型目录并启用（写入 catalogModels + selectedModels）。
   * 仅在尚未勾选任何模型时执行，避免覆盖用户在 API Key 设置里的手动选择。
   */
  const ensureSeedlingModelsEnabled = useCallback(async () => {
    const store = useAppStore.getState();
    if (store.config.providers?.seedling?.selectedModels?.length) return;
    try {
      const payload = await fetchSeedlingModels();
      const selections = buildSeedlingCatalogModels(payload.models ?? []);
      if (selections.length === 0) return;
      store.setProviderConfig('seedling', {
        name: '森之灵',
        catalogId: 'seedling',
        catalogModels: selections,
        selectedModels: selections,
      });
      await store.saveConfig();
      useAppStore.getState().showToast(`已自动启用 ${selections.length} 个森之灵模型`);
      await loadModels();
    } catch {
      // 拉取失败不阻塞：可在「API Key → 森之灵」中手动拉取目录
    }
  }, [loadModels]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await fetchSeedlingCliStatus();
      setCliStatus(status);
      if (status.auth) {
        updateConfig({
          seedlingAuth: {
            loggedIn: status.auth.loggedIn,
            username: status.auth.username || undefined,
            endpoint: status.auth.endpoint || undefined,
            tokenSource: savedToken ? 'api-key' : (status.auth.tokenSource || undefined),
            checkTs: Date.now(),
          },
        });
        if (status.auth.loggedIn || savedToken) {
          void ensureSeedlingModelsEnabled();
        }
      }
    } catch (error) {
      setCliStatus({ found: false, source: 'missing', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setStatusLoading(false);
    }
  }, [ensureSeedlingModelsEnabled, savedToken, updateConfig]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshStatus();
      void loadModels();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshStatus, loadModels]);

  // 监听登录运行态：事件驱动 + 轮询兜底（与即梦登录一致）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<SeedlingAuthLoginRuntime>(AUTH_EVENT, (event) => setLoginRuntime(event.payload)),
    ).then((stopListening) => {
      if (cancelled) stopListening();
      else unlisten = stopListening;
    }).catch(() => {});
    const timer = setInterval(async () => {
      try {
        setLoginRuntime(await getSeedlingAuthLoginRuntime());
      } catch {
        // 事件监听为主，轮询不可用时忽略
      }
    }, 1500);
    return () => {
      cancelled = true;
      unlisten?.();
      clearInterval(timer);
    };
  }, []);

  const openExternalUrl = useCallback(async (url: string) => {
    try {
      await import('@tauri-apps/plugin-shell').then(({ open }) => open(url));
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    useAppStore.getState().showToast(`已复制${label}`);
  }, []);

  const handleStartLogin = async () => {
    setLoginLoading(true);
    try {
      setLoginRuntime(await startSeedlingAuthLogin());
    } catch (error) {
      useAppStore.getState().showToast(error instanceof Error ? error.message : '启动登录失败', 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleCancelLogin = async () => {
    setLoginRuntime(await cancelSeedlingAuthLogin());
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await logoutSeedling();
      updateConfig({ seedlingAuth: { loggedIn: false } });
      useAppStore.getState().showToast('已退出森之灵登录');
      await refreshStatus();
    } catch (error) {
      useAppStore.getState().showToast(error instanceof Error ? error.message : '退出登录失败', 'error');
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleSaveToken = async () => {
    const token = apiToken.trim();
    if (!token) {
      useAppStore.getState().showToast('请输入 API Token', 'error');
      return;
    }
    setTokenSaving(true);
    try {
      setProviderKey('seedling', token);
      updateConfig({ seedlingAuth: { loggedIn: true, tokenSource: 'api-key', checkTs: Date.now() } });
      await saveConfig();
      setTokenSavedMsg('API Token 已保存');
      setApiToken('');
      await refreshStatus();
      await loadModels();
    } catch (error) {
      setTokenSavedMsg('');
      useAppStore.getState().showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setTokenSaving(false);
    }
  };

  const handleClearToken = async () => {
    try {
      setProviderKey('seedling', '');
      await saveConfig();
      setTokenSavedMsg('API Token 已清除，将回退使用 CLI 登录态');
      await refreshStatus();
    } catch (error) {
      useAppStore.getState().showToast(error instanceof Error ? error.message : '清除失败', 'error');
    }
  };

  const loggedIn = authMirror?.loggedIn || Boolean(savedToken);
  const loginPhase = loginRuntime?.phase || 'idle';
  const loginReady = loginPhase === 'oauth_ready' || loginPhase === 'polling';
  const loginWaiting = loginPhase === 'preparing' || loginPhase === 'starting';

  return (
    <div className="settings-pane">
      <div className="settings-pane-heading">
        <h2 className="settings-pane-title">森之灵</h2>
      </div>

      <div className="settings-pane-body provider-settings-body">
        {/* CLI 状态 */}
        <section className="provider-section">
          <h3 className="provider-section-title">CLI 状态</h3>
          <div className="provider-section-body">
            {statusLoading && <p className="settings-hint">正在检测 Seedling CLI…</p>}
            {!statusLoading && cliStatus && (
              <ul className="settings-status-list">
                <li>
                  检测结果：
                  {cliStatus.found
                    ? <span className="text-green-500">已找到</span>
                    : <span className="text-red-500">未找到</span>}
                  {cliStatus.source && <span className="settings-status-muted">（来源：{cliStatus.source}）</span>}
                </li>
                {cliStatus.version && <li>CLI 版本：{cliStatus.version}</li>}
                {cliStatus.auth && (
                  <>
                    <li>
                      认证状态：
                      {cliStatus.auth.loggedIn
                        ? <span className="text-green-500">已登录{cliStatus.auth.username ? `（${cliStatus.auth.username}）` : ''}</span>
                        : <span className="text-red-500">未登录或令牌失效</span>}
                    </li>
                    {cliStatus.auth.endpoint && <li>服务地址：{cliStatus.auth.endpoint}</li>}
                    {cliStatus.auth.tokenPreview && <li>Token 预览：{cliStatus.auth.tokenPreview}</li>}
                    {cliStatus.auth.message && <li className="settings-status-muted">{cliStatus.auth.message}</li>}
                  </>
                )}
                {cliStatus.error && <li className="settings-status-error">{cliStatus.error}</li>}
              </ul>
            )}
            <button
              type="button"
              className="settings-save-btn"
              disabled={statusLoading}
              onClick={() => void refreshStatus()}
            >
              重新检测
            </button>
          </div>
        </section>

        {/* 认证方式 A：CLI 浏览器授权登录 */}
        <section className="provider-section">
          <h3 className="provider-section-title">认证方式 A — CLI 浏览器授权登录</h3>
          <div className="provider-section-body">
            {loggedIn ? (
              <div className="provider-login-state">
                <p className="text-green-500">当前已通过 {authMirror?.tokenSource === 'api-key' ? 'API Token' : 'CLI 登录态'} 认证</p>
                <button
                  type="button"
                  className="settings-save-btn settings-btn-ghost"
                  disabled={logoutLoading}
                  onClick={() => void handleLogout()}
                >
                  {logoutLoading ? '正在退出…' : '退出登录'}
                </button>
              </div>
            ) : (
              <>
                <p className="settings-hint">
                  点击下方按钮，在浏览器中确认配对码完成授权，登录态由 Seedling CLI 持久化（90 天有效）。
                </p>
                <button
                  type="button"
                  className="settings-save-btn"
                  disabled={loginLoading || loginWaiting}
                  onClick={() => void handleStartLogin()}
                >
                  {loginLoading || loginWaiting ? '正在启动…' : '开始浏览器授权登录'}
                </button>
              </>
            )}

            {loginReady && loginRuntime && (
              <div className="seedling-login-guide">
                <div className="dreamina-manual-guide-head">
                  <div className="dreamina-manual-guide-title">浏览器授权（2 步）</div>
                </div>
                <div className="dreamina-manual-step">1) 打开授权链接</div>
                <div className="dreamina-manual-link-row">
                  <input
                    className="dreamina-manual-link-input"
                    readOnly
                    aria-label="森之灵授权链接"
                    value={loginRuntime.verificationUrl}
                  />
                  <button
                    type="button"
                    className="settings-save-btn"
                    disabled={!loginRuntime.verificationUrl}
                    onClick={() => loginRuntime.verificationUrl && openExternalUrl(loginRuntime.verificationUrl)}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    className="settings-save-btn settings-btn-ghost"
                    disabled={!loginRuntime.verificationUrl}
                    onClick={() => handleCopy(loginRuntime.verificationUrl, '授权链接')}
                  >
                    复制
                  </button>
                </div>
                <div className="dreamina-manual-step">2) 确认配对码</div>
                <div className="dreamina-manual-link-row">
                  <input
                    className="dreamina-manual-link-input dreamina-manual-code-input"
                    readOnly
                    aria-label="森之灵配对码"
                    value={loginRuntime.userCode}
                  />
                  <button
                    type="button"
                    className="settings-save-btn settings-btn-ghost"
                    disabled={!loginRuntime.userCode}
                    onClick={() => handleCopy(loginRuntime.userCode, '配对码')}
                  >
                    复制
                  </button>
                </div>
                <p className="settings-hint">{loginRuntime.message}</p>
                <button
                  type="button"
                  className="settings-save-btn settings-btn-ghost"
                  onClick={() => void handleCancelLogin()}
                >
                  取消登录
                </button>
              </div>
            )}

            {loginRuntime?.phase === 'success' && (
              <p className="text-green-500">{loginRuntime.message}</p>
            )}
            {loginRuntime?.phase === 'failed' && (
              <p className="settings-status-error">{loginRuntime.error || loginRuntime.message}</p>
            )}
          </div>
        </section>

        {/* 认证方式 B：API Token */}
        <section className="provider-section">
          <h3 className="provider-section-title">认证方式 B — API Token（机器令牌）</h3>
          <div className="provider-section-body">
            <p className="settings-hint">
              在 Seedling Web 端 → 头像菜单 → API 访问令牌 中创建（永久有效）。填写后优先于 CLI 登录态。
            </p>
            <div className="dreamina-manual-link-row">
              <input
                className="dreamina-manual-link-input"
                type="password"
                placeholder={savedToken ? '已保存（留空则使用 CLI 登录态）' : '粘贴 API Token'}
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
              />
              <button
                type="button"
                className="settings-save-btn"
                disabled={tokenSaving || !apiToken.trim()}
                onClick={() => void handleSaveToken()}
              >
                {tokenSaving ? '保存中…' : '保存 Token'}
              </button>
              {savedToken && (
                <button
                  type="button"
                  className="settings-save-btn settings-btn-ghost"
                  onClick={() => void handleClearToken()}
                >
                  清除
                </button>
              )}
            </div>
            {tokenSavedMsg && <p className="text-green-500">{tokenSavedMsg}</p>}
          </div>
        </section>

        {/* 可用模型 */}
        <section className="provider-section">
          <h3 className="provider-section-title">可用模型</h3>
          <div className="provider-section-body">
            {models.length === 0 ? (
              <p className="settings-hint">暂无模型，请先完成认证后刷新</p>
            ) : (
              <ul className="settings-status-list">
                {models.map((model) => (
                  <li key={model.id}>
                    <span className="settings-status-name">{model.name}</span>
                    <span className="settings-status-muted">（{model.id}）</span>
                    {model.supportedResolutions?.length
                      ? ` ${model.supportedResolutions.join('/')}`
                      : ''}
                    {model.supportsAudio ? ' · 支持配乐' : ''}
                    {model.description ? ` — ${model.description}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="settings-save-btn"
              onClick={() => void loadModels()}
            >
              刷新模型列表
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

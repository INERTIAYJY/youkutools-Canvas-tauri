/**
 * SeedlingSettings — 森之灵（Seedling）CLI 连接设置
 *
 * 认证说明：森之灵（Seedling）只有 CLI 一个接入通道（应用内驱动 seedling 二进制
 * 发起所有请求），认证凭据有两种，任一可用即可：
 *   A. CLI 登录态（seedling auth login 浏览器授权）：登录令牌由 CLI 配置文件持久化，
 *      本页展示授权链接/配对码并镜像登录状态到 config.seedlingAuth；
 *   B. API Token（机器令牌）：与方式 A 一样经 CLI 使用——写入 config.providers.seedling.apiKey，
 *      持久化时由 providerSecretService 摘进 Rust secret_store，运行时以
 *      SEEDLING_TOKEN 环境变量注入 CLI（CLI 优先级：环境变量 > 配置文件）。
 *      API Token 不能脱离 CLI 单独调用平台接口（平台未公开独立 REST API）。
 *
 * 同时展示 CLI 检测状态（found / version / source）与可用模型列表。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { SeedlingAuthLoginRuntime, SeedlingCliStatus, SeedlingModelInfo } from '../../services/seedlingService';
import {
  cancelSeedlingAuthLogin,
  fetchSeedlingCliStatus,
  fetchSeedlingModels,
  getSeedlingAuthLoginRuntime,
  installSeedlingCli,
  logoutSeedling,
  startSeedlingAuthLogin,
} from '../../services/seedlingService';
import { buildSeedlingCatalogModels } from '../../services/ai/providerCatalogService';

const AUTH_EVENT = 'seedling-login-runtime';

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${ok ? 'bg-green-400' : 'bg-red-400'}`}
      aria-hidden="true"
    />
  );
}

export default function SeedlingSettings() {
  const setProviderKey = useAppStore((state) => state.setProviderKey);
  const updateConfig = useAppStore((state) => state.updateConfig);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const config = useAppStore((state) => state.config);

  const [cliStatus, setCliStatus] = useState<SeedlingCliStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
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

  const lastModelFailTs = useRef(0);

  /**
   * 认证成功后自动拉取模型目录并启用（写入 catalogModels + selectedModels）。
   * 仅在尚未勾选任何模型时执行，避免覆盖用户在 API Key 设置里的手动选择。
   * 失败时给出可见提示（30s 去重），便于新装电脑定位（CLI 下载/网络问题）。
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
    } catch (error) {
      const now = Date.now();
      if (now - lastModelFailTs.current > 30_000) {
        lastModelFailTs.current = now;
        const message = error instanceof Error ? error.message : String(error);
        useAppStore.getState().showToast(`森之灵模型加载失败：${message}`, 'error');
      }
    }
  }, [loadModels]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      // CLI 认证区独立显示：不带 API Token，只反映 CLI 配置文件的登录态。
      // 否则仅配置 API Token 时，退出 CLI 登录后仍会被 Token 验证成「已登录」。
      const status = await fetchSeedlingCliStatus(false);
      setCliStatus(status);
      if (status.auth) {
        updateConfig({
          seedlingAuth: {
            loggedIn: status.auth.loggedIn,
            username: status.auth.username || undefined,
            endpoint: status.auth.endpoint || undefined,
            tokenSource: status.auth.tokenSource || undefined,
            checkTs: Date.now(),
          },
        });
      }
      // 模型加载：CLI 登录态或 API Token 任一可用即可（两者均经 CLI 使用）
      const hasSavedToken = Boolean(
        useAppStore.getState().config.providers?.seedling?.apiKey,
      );
      if (status.auth?.loggedIn || hasSavedToken) {
        void ensureSeedlingModelsEnabled();
      }
    } catch (error) {
      setCliStatus({ found: false, source: 'missing', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setStatusLoading(false);
    }
  }, [ensureSeedlingModelsEnabled, updateConfig]);

  /** 显式安装 / 更新应用内置 CLI（强制下载最新版到应用缓存目录）。 */
  const handleInstallCli = async () => {
    setInstalling(true);
    try {
      useAppStore.getState().showToast('正在下载 Seedling CLI…');
      const status = await installSeedlingCli();
      setCliStatus(status);
      if (status.auth) {
        updateConfig({
          seedlingAuth: {
            loggedIn: status.auth.loggedIn,
            username: status.auth.username || undefined,
            endpoint: status.auth.endpoint || undefined,
            tokenSource: status.auth.tokenSource || undefined,
            checkTs: Date.now(),
          },
        });
      }
      if (status.found) {
        useAppStore.getState().showToast(`Seedling CLI 安装完成（v${status.version ?? '?'}）`);
        const hasSavedToken = Boolean(
          useAppStore.getState().config.providers?.seedling?.apiKey,
        );
        if (status.auth?.loggedIn || hasSavedToken) {
          void ensureSeedlingModelsEnabled();
        }
        void loadModels();
      }
    } catch (error) {
      useAppStore.getState().showToast(
        error instanceof Error ? error.message : 'Seedling CLI 安装失败',
        'error',
      );
    } finally {
      setInstalling(false);
    }
  };

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

  // 登录成功（CLI 已写入登录令牌）后立即刷新认证镜像并自动启用模型
  const loginSuccessHandledRef = useRef(false);
  useEffect(() => {
    if (loginRuntime?.phase !== 'success') return;
    if (loginSuccessHandledRef.current) return;
    loginSuccessHandledRef.current = true;
    useAppStore.getState().showToast('森之灵登录成功');
    void refreshStatus();
    void loadModels();
  }, [loginRuntime?.phase, refreshStatus, loadModels]);

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
      // 注意：不写 seedlingAuth 镜像（那是 CLI 登录态），API Token 是另一份认证凭据
      await saveConfig();
      setTokenSavedMsg('API Token 已保存（经 CLI 使用）');
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

  // CLI 认证区独立判断：authMirror 只反映 CLI 配置文件的登录态（refreshStatus 不带 API Token 查询）。
  // API Token 是另一份认证凭据，存在性单独由 savedToken 判断，不再混入 CLI 登录态。
  const cliLoggedIn = authMirror?.loggedIn === true;
  const loginPhase = loginRuntime?.phase || 'idle';
  const loginReady = loginPhase === 'oauth_ready' || loginPhase === 'polling';
  const loginWaiting = loginPhase === 'preparing' || loginPhase === 'starting';
  const cliFound = cliStatus?.found ?? false;
  const authOk = cliStatus?.auth?.loggedIn ?? false;

  return (
    <div className="space-y-4">
      {/* ── CLI 状态 ── */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-canvas-text">CLI 状态</h3>
        <div className="rounded-lg border border-canvas-border bg-canvas-card p-3 space-y-2">
          {statusLoading ? (
            <p className="text-xs text-canvas-text-muted">正在检测 Seedling CLI…</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-canvas-text-secondary">
                <StatusDot ok={cliFound} />
                <span>CLI 检测：</span>
                <span className={cliFound ? 'text-green-500' : 'text-red-400'}>
                  {cliFound ? '已找到' : '未找到'}
                </span>
                {cliStatus?.source && (
                  <span className="text-canvas-text-muted">（来源：{cliStatus.source}）</span>
                )}
              </div>
              {cliStatus?.version && (
                <div className="text-xs text-canvas-text-secondary">CLI 版本：{cliStatus.version}</div>
              )}
              {cliStatus?.auth && (
                <>
                  <div className="flex items-center gap-2 text-xs text-canvas-text-secondary">
                    <StatusDot ok={authOk} />
                    <span>认证状态：</span>
                    <span className={authOk ? 'text-green-500' : 'text-red-400'}>
                      {authOk ? `已登录${cliStatus.auth.username ? `（${cliStatus.auth.username}）` : ''}` : '未登录或令牌失效'}
                    </span>
                  </div>
                  {cliStatus.auth.endpoint && (
                    <div className="text-xs text-canvas-text-secondary">服务地址：{cliStatus.auth.endpoint}</div>
                  )}
                  {cliStatus.auth.tokenPreview && (
                    <div className="text-xs text-canvas-text-secondary">Token 预览：{cliStatus.auth.tokenPreview}</div>
                  )}
                  {cliStatus.auth.message && (
                    <p className="text-xs text-canvas-text-muted">{cliStatus.auth.message}</p>
                  )}
                </>
              )}
              {cliStatus?.error && <p className="text-xs text-red-400">{cliStatus.error}</p>}
            </>
          )}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              className="settings-save-btn"
              disabled={statusLoading || installing}
              onClick={() => void refreshStatus()}
            >
              {statusLoading ? '检测中…' : '重新检测'}
            </button>
            <button
              type="button"
              className={`settings-save-btn ${cliFound ? 'settings-btn-ghost' : ''}`}
              disabled={installing || statusLoading}
              onClick={() => void handleInstallCli()}
            >
              {installing ? '安装中…' : cliFound ? '更新 CLI' : '安装 CLI'}
            </button>
          </div>
        </div>
      </div>

      {/* ── 认证方式 A：CLI 浏览器授权登录（CLI 登录态凭据） ── */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-canvas-text">认证方式 A — CLI 浏览器授权登录（CLI 登录态凭据）</h3>
        <div className="rounded-lg border border-canvas-border bg-canvas-card p-3 space-y-2">
          {cliLoggedIn ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-canvas-text-secondary">
                <StatusDot ok />
                <span>CLI 已登录{authMirror?.username ? `（${authMirror.username}）` : ''}</span>
              </div>
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-canvas-text-secondary">CLI 未登录</p>
                <p className="mt-0.5 text-xs text-canvas-text-muted leading-relaxed">
                  在浏览器中确认配对码完成授权，登录态由 Seedling CLI 持久化（90 天有效）。CLI 登录态与 API Token 均为认证凭据，视频生成统一经 CLI 发起。
                </p>
              </div>
              <button
                type="button"
                className="settings-save-btn shrink-0"
                disabled={loginLoading || loginWaiting}
                onClick={() => void handleStartLogin()}
              >
                {loginLoading || loginWaiting ? '正在启动…' : '开始浏览器授权登录'}
              </button>
            </div>
          )}

          {loginReady && loginRuntime && (
            <div className="space-y-2 border-t border-canvas-border pt-2">
              <div className="text-xs font-medium text-canvas-text">浏览器授权（2 步）</div>
              <div className="text-xs text-canvas-text-muted">1) 打开授权链接</div>
              <div className="flex items-center gap-1.5">
                <input
                  className="dreamina-manual-link-input"
                  readOnly
                  aria-label="森之灵授权链接"
                  value={loginRuntime.verificationUrl}
                />
                <button
                  type="button"
                  className="settings-save-btn shrink-0"
                  disabled={!loginRuntime.verificationUrl}
                  onClick={() => loginRuntime.verificationUrl && openExternalUrl(loginRuntime.verificationUrl)}
                >
                  打开
                </button>
                <button
                  type="button"
                  className="settings-save-btn settings-btn-ghost shrink-0"
                  disabled={!loginRuntime.verificationUrl}
                  onClick={() => handleCopy(loginRuntime.verificationUrl, '授权链接')}
                >
                  复制
                </button>
              </div>
              <div className="text-xs text-canvas-text-muted">2) 确认配对码</div>
              <div className="flex items-center gap-1.5">
                <input
                  className="dreamina-manual-link-input dreamina-manual-code-input"
                  readOnly
                  aria-label="森之灵配对码"
                  value={loginRuntime.userCode}
                />
                <button
                  type="button"
                  className="settings-save-btn settings-btn-ghost shrink-0"
                  disabled={!loginRuntime.userCode}
                  onClick={() => handleCopy(loginRuntime.userCode, '配对码')}
                >
                  复制
                </button>
              </div>
              <p className="text-xs text-canvas-text-muted">{loginRuntime.message}</p>
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
            <p className="text-xs text-green-500">{loginRuntime.message}</p>
          )}
          {loginRuntime?.phase === 'failed' && (
            <p className="text-xs text-red-400">{loginRuntime.error || loginRuntime.message}</p>
          )}
        </div>
      </div>

      {/* ── 认证方式 B：API Token（机器令牌凭据，经 CLI 使用） ── */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-canvas-text">认证方式 B — API Token（机器令牌凭据）</h3>
        <div className="rounded-lg border border-canvas-border bg-canvas-card p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-canvas-text-secondary">
            <StatusDot ok={Boolean(savedToken)} />
            <span>{savedToken ? 'API Token 已配置（经 CLI 使用）' : '未配置 API Token（仅使用 CLI 登录态）'}</span>
          </div>
          <p className="text-xs text-canvas-text-muted leading-relaxed">
            在 Seedling Web 端 → 头像菜单 → API 访问令牌 中创建（永久有效）。Token 以 SEEDLING_TOKEN 环境变量注入 CLI 使用，不能脱离 CLI 单独接入平台。
          </p>
          <div className="flex items-center gap-1.5">
            <input
              className="dreamina-manual-link-input"
              type="password"
              placeholder={savedToken ? '已保存（输入新值可覆盖）' : '粘贴 API Token'}
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
            />
            <button
              type="button"
              className="settings-save-btn shrink-0"
              disabled={tokenSaving || !apiToken.trim()}
              onClick={() => void handleSaveToken()}
            >
              {tokenSaving ? '保存中…' : '保存 Token'}
            </button>
            {savedToken && (
              <button
                type="button"
                className="settings-save-btn settings-btn-ghost shrink-0"
                onClick={() => void handleClearToken()}
              >
                清除
              </button>
            )}
          </div>
          {tokenSavedMsg && <p className="text-xs text-green-500">{tokenSavedMsg}</p>}
        </div>
      </div>

      {/* ── 可用模型 ── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-canvas-text">可用模型</h3>
          <button
            type="button"
            className="settings-save-btn"
            onClick={() => void loadModels()}
          >
            刷新
          </button>
        </div>
        <div className="rounded-lg border border-canvas-border bg-canvas-card p-3">
          {models.length === 0 ? (
            <p className="text-xs text-canvas-text-muted">暂无模型，请先完成认证后刷新</p>
          ) : (
            <ul className="space-y-1.5">
              {models.map((model) => (
                <li key={model.id} className="flex items-baseline gap-2 text-xs">
                  <span className="text-canvas-text">{model.name}</span>
                  <span className="text-canvas-text-muted">{model.id}</span>
                  {model.supportedResolutions?.length && (
                    <span className="text-canvas-text-secondary">{model.supportedResolutions.join('/')}</span>
                  )}
                  {model.supportsAudio && <span className="text-canvas-text-secondary">· 支持配乐</span>}
                  {model.description && (
                    <span className="truncate text-canvas-text-muted">— {model.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

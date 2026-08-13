/**
 * MCP 本地控制设置页，管理 bridge 会话、固定端口/令牌、自动开启和外部客户端配置片段。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useShallow } from 'zustand/react/shallow';
import AnimatedButton from '../shared/AnimatedButton';
import { useAppStore } from '../../store/useAppStore';
import {
  getMcpBridgeStatus,
  stopMcpBridge,
} from '../../services/mcp/mcpBridgeService';
import type { McpBridgeSessionInfo } from '../../types/mcp';
import {
  buildMcpClientConfig,
  ensureMcpSessionToken,
  normalizeMcpPort,
  rotateMcpSessionToken,
  startConfiguredMcpBridge,
} from '../../services/mcp/mcpSessionConfig';
import { MCP_CONNECTION_REQUIREMENTS } from './mcpConnectionRequirements';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

export default function McpControlSettings() {
  const { config, updateConfig, saveConfig } = useAppStore(useShallow((state) => ({
    config: state.config,
    updateConfig: state.updateConfig,
    saveConfig: state.saveConfig,
  })));
  const [session, setSession] = useState<McpBridgeSessionInfo | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const portInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    getMcpBridgeStatus()
      .then(async (status) => {
        if (cancelled) return;
        setSession(status);
        // 会话已在运行（多为自动开启拉起的）时补出令牌，配置片段才能直接复制
        if (status) setToken(await ensureMcpSessionToken());
      })
      .catch(() => {
        if (!cancelled) setError('无法读取 MCP 会话状态');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientConfig = useMemo(
    () => session && token ? buildMcpClientConfig(session, token) : null,
    [session, token],
  );

  const persistConfig = (patch: Parameters<typeof updateConfig>[0]) => {
    updateConfig(patch);
    void saveConfig();
  };

  const handleStart = async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const started = await startConfiguredMcpBridge();
      setToken(started.token);
      setSession(started.session);
    } catch (startError) {
      setToken('');
      setSession(null);
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError('');
    try {
      await stopMcpBridge();
      setSession(null);
      setToken('');
      setCopied(false);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    } finally {
      setLoading(false);
    }
  };

  // 轮换令牌会作废所有已发出的客户端配置；会话在运行时顺带重启，避免新旧令牌不一致。
  const handleRotateToken = async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const nextToken = await rotateMcpSessionToken();
      if (session) {
        await stopMcpBridge();
        const started = await startConfiguredMcpBridge();
        setSession(started.session);
        setToken(started.token);
      } else {
        setToken(nextToken);
      }
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : String(rotateError));
    } finally {
      setLoading(false);
    }
  };

  // ponytail: 20000-44999 随机，避开 Windows 动态端口段（49152+）与常见服务端口。
  // 万一撞上占用，开启会话时会明确报错，再点一次即可。
  const handleRandomPort = () => {
    const next = 20000 + Math.floor(Math.random() * 25000);
    if (portInputRef.current) portInputRef.current.value = String(next);
    setError('');
    persistConfig({ mcpPort: next });
  };

  const handleCopy = async () => {
    if (!clientConfig) return;
    try {
      await navigator.clipboard.writeText(clientConfig);
      setCopied(true);
    } catch {
      setError('复制客户端配置失败');
    }
  };

  const configuredPort = normalizeMcpPort(config.mcpPort);
  const portChanged = session !== null && configuredPort !== undefined && configuredPort !== session.port;

  if (!isTauri) {
    return (
      <div className="rounded-md border border-canvas-border bg-canvas-surface px-4 py-3 text-sm text-canvas-text-secondary">
        MCP 控制仅在 Tauri 桌面应用中可用。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-canvas-border pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-canvas-text">
            <span
              className={`h-2 w-2 rounded-full ${session ? 'bg-green-400' : 'bg-canvas-text-muted'}`}
              aria-hidden="true"
            />
            {session ? '本地控制会话已开启' : '本地控制会话已关闭'}
          </div>
          <p className="mt-1 text-xs text-canvas-text-muted">
            {session
              ? `回环端口 ${session.port}${configuredPort === undefined ? '（随机）' : '（固定）'}`
              : config.mcpAutoStart ? '启动软件时自动开启' : '默认关闭'}
          </p>
        </div>
        <AnimatedButton
          type="button"
          className="settings-save-btn shrink-0 text-xs"
          onClick={session ? handleStop : handleStart}
          disabled={loading}
        >
          <Icon icon={session ? 'lucide:power-off' : 'lucide:power'} width="14" height="14" />
          {loading ? '处理中' : session ? '停止' : '开启'}
        </AnimatedButton>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-canvas-border bg-canvas-card px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
          checked={config.mcpAutoStart === true}
          onChange={(event) => persistConfig({ mcpAutoStart: event.target.checked })}
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-canvas-text">启动软件时自动开启</span>
          <span className="mt-0.5 block text-[11px] text-canvas-text-muted">
            外部客户端无需每次手动开启会话；令牌固定保存在本机凭据存储中。
          </span>
        </span>
      </label>

      <div className="rounded-md border border-canvas-border bg-canvas-card px-3 py-2.5">
        <div className="text-xs font-medium text-canvas-text">固定回环端口</div>
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={portInputRef}
            type="number"
            min={1024}
            max={65535}
            placeholder="留空则每次随机分配"
            defaultValue={configuredPort ?? ''}
            className="min-w-0 flex-1 rounded-md border border-canvas-border bg-canvas-surface px-3 py-2 text-sm text-canvas-text placeholder-canvas-text-muted transition-colors focus:border-indigo-500 focus:outline-none"
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const next = raw ? normalizeMcpPort(raw) : undefined;
              if (raw && next === undefined) {
                setError('端口需在 1024-65535 之间');
                event.target.value = String(configuredPort ?? '');
                return;
              }
              setError('');
              event.target.value = next ? String(next) : '';
              persistConfig({ mcpPort: next });
            }}
          />
          <button
            type="button"
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface px-3 text-xs text-canvas-text-secondary transition-colors hover:bg-canvas-hover hover:text-canvas-text"
            onClick={handleRandomPort}
            title="随机挑一个固定端口"
          >
            <Icon icon="lucide:dices" width="14" height="14" />
            随机
          </button>
        </div>
        <p className="mt-2 text-[11px] text-canvas-text-muted">
          固定端口后客户端配置不再变化，写一次即可。
          {portChanged ? ' 新端口在下次开启会话时生效。' : ''}
        </p>
      </div>

      {session && !token && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          本页没有当前令牌。停止后重新开启以生成新的客户端配置。
        </div>
      )}

      {clientConfig && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-canvas-text-secondary">客户端配置片段</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-canvas-text-secondary transition-colors hover:bg-canvas-hover hover:text-canvas-text disabled:opacity-50"
                onClick={handleRotateToken}
                disabled={loading}
                title="生成新令牌，旧配置立即失效"
              >
                <Icon icon="lucide:refresh-cw" width="12" height="12" />
                重置令牌
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-canvas-text-secondary transition-colors hover:bg-canvas-hover hover:text-canvas-text"
                onClick={handleCopy}
                aria-label="复制 MCP 客户端配置"
                title="复制客户端配置"
              >
                <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width="14" height="14" />
              </button>
            </div>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[11px] leading-relaxed text-canvas-text-secondary select-all">
            {clientConfig}
          </pre>
          <p className="text-[11px] text-canvas-text-muted">
            粘贴到 Claude Desktop / Cursor 等客户端的 MCP 配置中。会话未开启时客户端调用会报错，重新开启即可继续用同一份配置。
          </p>
        </div>
      )}

      <section
        className="rounded-md border border-canvas-border bg-canvas-card px-3 py-3"
        aria-labelledby="mcp-connection-requirements-title"
      >
        <div className="flex items-center gap-2">
          <Icon icon="lucide:circle-check-big" width="14" height="14" className="text-indigo-400" />
          <h3 id="mcp-connection-requirements-title" className="text-xs font-medium text-canvas-text">
            连接环境要求
          </h3>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {MCP_CONNECTION_REQUIREMENTS.map((requirement) => (
            <div key={requirement.title} className="flex items-start gap-2 rounded-md bg-canvas-surface px-2.5 py-2">
              <Icon
                icon={requirement.icon}
                width="14"
                height="14"
                className="mt-0.5 shrink-0 text-canvas-text-secondary"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-canvas-text">{requirement.title}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-canvas-text-muted">
                  {requirement.description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-canvas-border pt-2.5 text-[11px] leading-relaxed text-canvas-text-muted">
          <p>
            <span className="font-medium text-canvas-text-secondary">首次连接：</span>
            开启会话 → 复制上方配置 → 粘贴到客户端的 MCP 配置中 → 完全重启客户端。
          </p>
          <p className="mt-1">
            修改端口或重置令牌后，需要重新复制配置并重启客户端。调用联网、云端模型或本地模型功能时，还需提前配置对应的网络、API Key 或模型环境。
          </p>
        </div>
      </section>

      {session && token && !clientConfig && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          未找到本地 MCP 适配器脚本。
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

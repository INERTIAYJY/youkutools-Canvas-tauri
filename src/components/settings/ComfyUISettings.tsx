import { useState } from 'react';
import { Icon } from '@iconify/react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import AnimatedButton from '../shared/AnimatedButton';

type ComfyStatus = 'idle' | 'starting' | 'ready' | 'failed';

export default function ComfyUISettings() {
  const {
    config,
    updateConfig,
    saveConfig,
    workflows,
    setSettingsOpen,
    setWorkflowPanelOpen,
    showToast,
  } = useAppStore(useShallow((state) => ({
    config: state.config,
    updateConfig: state.updateConfig,
    saveConfig: state.saveConfig,
    workflows: state.workflows,
    setSettingsOpen: state.setSettingsOpen,
    setWorkflowPanelOpen: state.setWorkflowPanelOpen,
    showToast: state.showToast,
  })));
  const [launching, setLaunching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState<ComfyStatus>('idle');
  const comfyUIPath = config.comfyUIPath;

  const openComfyUI = async () => {
    const comfyUrl = config.comfyUIUrl?.trim() || 'http://127.0.0.1:8188';
    setOpening(true);
    try {
      await invoke<void>('open_comfyui_window', { comfyUrl });
    } catch (error) {
      showToast(typeof error === 'string' ? error : '打开 ComfyUI 页面失败', 'error');
    } finally {
      setOpening(false);
    }
  };

  const choosePath = async () => {
    try {
      const selected = await openDialog({ directory: true, title: '选择 ComfyUI 安装目录' });
      if (selected && typeof selected === 'string') {
        updateConfig({ comfyUIPath: selected });
        await saveConfig();
      }
    } catch {
      // 浏览器环境忽略
    }
  };

  const launch = async () => {
    const comfyPath = config.comfyUIPath?.trim();
    if (!comfyPath) {
      showToast('请先设置 ComfyUI 安装目录', 'error');
      return;
    }
    setLaunching(true);
    setStatus('starting');
    try {
      await invoke<string>('launch_comfyui', { comfyPath });
      const base = (config.comfyUIUrl?.trim() || 'http://127.0.0.1:8188').replace(/\/+$/, '');
      const deadline = Date.now() + 300_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          await fetch(`${base}/system_stats`, { mode: 'no-cors' });
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      setStatus(ready ? 'ready' : 'failed');
      if (ready) {
        await openComfyUI();
      }
      showToast(
        ready ? 'ComfyUI 服务已就绪' : 'ComfyUI 进程已启动，但等待服务就绪超时，请查看终端窗口日志',
        ready ? 'success' : 'error',
      );
    } catch (error) {
      setStatus('failed');
      showToast(typeof error === 'string' ? error : '启动 ComfyUI 失败', 'error');
    } finally {
      setLaunching(false);
    }
  };

  const openWorkflows = () => {
    setSettingsOpen(false);
    setWorkflowPanelOpen(true);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-canvas-text mb-2">ComfyUI 安装目录</h3>
        <div className="bg-canvas-card border border-canvas-border rounded-lg p-2">
          <div className="text-xs text-canvas-text-muted mb-1.5">ComfyUI 根目录路径</div>
          <div className="flex items-center gap-2 mb-3">
            <div className={`flex-1 min-w-0 text-[11px] break-all bg-canvas-surface rounded-md px-3 py-1.5 border border-canvas-border ${
              comfyUIPath ? 'text-canvas-text-secondary font-mono leading-relaxed select-all' : 'text-canvas-text-muted italic'
            }`}>
              {comfyUIPath || '未设置'}
            </div>
            <AnimatedButton type="button" className="settings-save-btn shrink-0 text-xs" onClick={choosePath}>
              {comfyUIPath ? '更换' : '选择文件夹'}
            </AnimatedButton>
          </div>
          <p className="text-[11px] text-canvas-text-muted leading-relaxed mb-3">
            选择 ComfyUI 的安装根目录，支持 GitHub 源码版 / 秋叶整合包 / 官方便携版 / Comfy Desktop（选安装基目录，如 F:\ComfyUI）。将以 API 模式直接启动，跳过启动器检测
          </p>
          <div className="pt-2 border-t border-canvas-border">
            <div className="grid grid-cols-2 gap-2">
              <AnimatedButton
                type="button"
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors text-sm font-medium"
                onClick={launch}
                disabled={launching}
              >
                {launching ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8" />
                    </svg>
                    正在启动…
                  </>
                ) : (
                  <>
                    <Icon icon="lucide:play" width="16" height="16" />
                    启动 ComfyUI
                  </>
                )}
              </AnimatedButton>
              <AnimatedButton
                type="button"
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-canvas-surface border border-canvas-border text-canvas-text-secondary hover:bg-canvas-hover hover:text-canvas-text transition-colors text-sm font-medium"
                onClick={() => void openComfyUI()}
                disabled={opening}
              >
                <Icon icon={opening ? 'lucide:loader-circle' : 'lucide:external-link'} width="16" height="16" className={opening ? 'animate-spin' : ''} />
                打开 ComfyUI 页面
              </AnimatedButton>
            </div>
            {status === 'starting' && <p className="text-[11px] text-canvas-text-secondary mt-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />正在等待 ComfyUI 服务就绪，首次启动可能需要几分钟时间…</p>}
            {status === 'ready' && <p className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />ComfyUI 服务已就绪（{config.comfyUIUrl?.trim() || 'http://127.0.0.1:8188'}），可以开始使用</p>}
            {status === 'failed' && <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />服务未就绪，请查看弹出的终端窗口中的日志</p>}
            {status === 'idle' && <p className="text-[11px] text-canvas-text-muted mt-2">服务就绪后会自动在软件内打开 ComfyUI 窗口，也可以使用右侧按钮手动打开</p>}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-canvas-text mb-2">ComfyUI 服务地址</h3>
        <div className="bg-canvas-card border border-canvas-border rounded-lg p-2">
          <div className="text-xs text-canvas-text-muted mb-1.5">后端地址</div>
          <input
            type="text"
            className="w-full text-sm bg-canvas-surface border border-canvas-border rounded-md px-3 py-2 text-canvas-text placeholder-canvas-text-muted focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder="http://127.0.0.1:8188"
            defaultValue={config.comfyUIUrl || ''}
            onBlur={async (event) => {
              updateConfig({ comfyUIUrl: event.target.value });
              await saveConfig();
            }}
          />
          <p className="text-[11px] text-canvas-text-muted mt-2">ComfyUI 后端服务的地址，用于执行导入的工作流。默认端口为 8188</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-canvas-text mb-2">ComfyUI 工作流</h3>
        <div className="bg-canvas-card border border-canvas-border rounded-lg p-2 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center shrink-0">
            <Icon icon="lucide:workflow" width="18" height="18" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-canvas-text">工作流管理</div>
            <div className="text-[11px] text-canvas-text-muted mt-0.5">已导入 {workflows.length} 个工作流</div>
          </div>
          <AnimatedButton type="button" className="settings-save-btn shrink-0 text-xs flex items-center gap-1.5" onClick={openWorkflows}>
            管理工作流
            <Icon icon="lucide:chevron-right" width="14" height="14" />
          </AnimatedButton>
        </div>
      </div>
    </div>
  );
}

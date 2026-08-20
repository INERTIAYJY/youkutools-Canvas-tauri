/**
 * VideoEditorAiTransitionPanel — 转场分组里的 AI 生成入口
 *
 * 预设转场靠不透明度在本地合成；这里则把「前一段尾帧 → 本段首帧」交给视频模型，
 * 生成一段真实过渡画面插进主轨。模型目录与调用都在主窗口，这里只收集参数。
 */
import { memo, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { VideoEditorModelOption } from '../../services/videoEditorWindowService';
import { useT } from '../../i18n';

interface VideoEditorAiTransitionPanelProps {
  /** 可用的视频模型；为空表示主窗口还没下发或没有配置 */
  models: VideoEditorModelOption[];
  busy: boolean;
  status: string | null;
  error: string | null;
  /** 选中的片段能否作为转场终点（必须在主轨上且不是第一段） */
  canGenerate: boolean;
  onRefreshModels: () => void;
  onGenerate: (options: {
    prompt: string;
    model: string;
    provider: string;
    duration: number;
  }) => void;
}

const DURATION_OPTIONS = [2, 3, 4, 5];

function VideoEditorAiTransitionPanel({
  models,
  busy,
  status,
  error,
  canGenerate,
  onRefreshModels,
  onGenerate,
}: VideoEditorAiTransitionPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [duration, setDuration] = useState(3);

  const selectedModel = useMemo(
    () => models.find((option) => option.value === model) ?? models[0],
    [model, models],
  );

  const submit = () => {
    if (!selectedModel || !prompt.trim() || busy || !canGenerate) return;
    onGenerate({
      prompt: prompt.trim(),
      model: selectedModel.value,
      provider: selectedModel.provider,
      duration,
    });
  };

  return (
    <div className="video-editor-ai-transition">
      <button
        type="button"
        className="video-editor-ai-transition-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon="lucide:sparkles" width={13} height={13} />
        <span>{t('AI 生成转场')}</span>
        <Icon icon={open ? 'lucide:chevron-up' : 'lucide:chevron-down'} width={13} height={13} />
      </button>

      {open && (
        <div className="video-editor-ai-transition-body">
          <p className="video-editor-ai-transition-hint">
            {t('取前一段的尾帧作首帧、本段的首帧作尾帧，按提示词生成一段过渡视频并插入两段之间')}
          </p>

          <label className="video-editor-field-stack">
            <span>{t('转场描述')}</span>
            <textarea
              rows={3}
              value={prompt}
              maxLength={500}
              placeholder={t('例如：镜头快速推近穿过火光，自然过渡到下一场景')}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <label className="video-editor-inspect-slider">
            <span>{t('模型')}</span>
            <select
              value={selectedModel?.value ?? ''}
              disabled={models.length === 0 || busy}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.length === 0 && <option value="">{t('暂无可用视频模型')}</option>}
              {models.map((option) => (
                <option key={option.value} value={option.value}>
                  {t('{group} · {name}', { group: option.groupName, name: option.label })}
                </option>
              ))}
            </select>
          </label>

          <label className="video-editor-inspect-slider">
            <span>{t('时长')}</span>
            <select
              value={duration}
              disabled={busy}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {DURATION_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}s</option>
              ))}
            </select>
          </label>

          <div className="video-editor-ai-transition-actions">
            <button
              type="button"
              className="video-editor-ai-transition-refresh"
              disabled={busy}
              onClick={onRefreshModels}
            >
              <Icon icon="lucide:refresh-cw" width={12} height={12} />
              {t('刷新模型')}
            </button>
            <button
              type="button"
              className={`video-editor-ai-transition-submit${busy ? ' busy' : ''}`}
              disabled={busy || !canGenerate || !selectedModel || !prompt.trim()}
              onClick={submit}
            >
              <Icon icon={busy ? 'lucide:loader-circle' : 'lucide:wand-sparkles'} width={13} height={13} />
              {busy ? t('生成中…') : t('生成转场')}
            </button>
          </div>

          {!canGenerate && (
            <p className="video-editor-ai-transition-note">
              {t('请先在主轨上选中第二段及之后的片段——转场要插在它与前一段之间')}
            </p>
          )}
          {status && <p className="video-editor-ai-transition-note">{status}</p>}
          {error && <p className="video-editor-ai-transition-note error">{error}</p>}
          {models.length === 0 && (
            <p className="video-editor-ai-transition-note">
              {t('没有收到可用模型：请确认主窗口仍开着该视频节点所在的项目，并已在「设置 → API Key」中配置视频模型')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(VideoEditorAiTransitionPanel);

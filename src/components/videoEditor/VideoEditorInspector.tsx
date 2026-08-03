/**
 * VideoEditorInspector — 右侧属性检查器
 *
 * 一期只读展示选中片段与源素材信息；Transform / Appearance / Effects 等
 * 可编辑分组留到二期，分组骨架先按最终布局占位。
 */
import { memo, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import VideoEditorCodecPanel from './VideoEditorCodecPanel';
import VideoEditorTextPanel from './VideoEditorTextPanel';
import VideoEditorTransitionPanel from './VideoEditorTransitionPanel';
import type { VideoEditorModelOption } from '../../services/videoEditorWindowService';
import {
  DEFAULT_TRANSFORM,
  getClipDuration,
  type VideoEditorClip,
  type VideoEditorSourceProbe,
  type VideoEditorTextStyle,
  type VideoEditorTransform,
  type VideoEditorTransitionKind,
} from '../../types/videoEditor';

interface VideoEditorInspectorProps {
  clip: VideoEditorClip | null;
  locked: boolean;
  probe: VideoEditorSourceProbe | null;
  clipCount: number;
  timelineDuration: number;
  canvasSize: { width: number; height: number };
  compositing: boolean;
  mixedSources: boolean;
  frameRate: number;
  onFrameRateChange: (fps: number) => void;
  outputScale: number;
  onOutputScaleChange: (scale: number) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
  onTransformChange: (patch: Partial<VideoEditorTransform>) => void;
  onTransitionChange: (kind: VideoEditorTransitionKind, duration: number) => void;
  onVolumeChange: (volume: number) => void;
  onAddText: () => void;
  onPatchText: (patch: Partial<VideoEditorTextStyle>) => void;
  /** 受控标签：时间轴点接缝时要能直接切到「转场」 */
  activeTab: VideoEditorInspectorTab;
  onActiveTabChange: (tab: VideoEditorInspectorTab) => void;
  // ── AI 转场：模型目录与生成都在主窗口，这里只透传状态与回调 ──
  aiModels: VideoEditorModelOption[];
  aiTransitionBusy: boolean;
  aiTransitionStatus: string | null;
  aiTransitionError: string | null;
  canGenerateAiTransition: boolean;
  onRefreshAiModels: () => void;
  onGenerateAiTransition: (options: {
    prompt: string;
    model: string;
    provider: string;
    duration: number;
  }) => void;
}

const PENDING_SECTIONS = ['滤镜'];
export type VideoEditorInspectorTab = 'properties' | 'text' | 'transition';
type PropertyTab = 'clip' | 'transform' | 'audio' | 'export';

function rangeProgress(value: number, min: number, max: number): CSSProperties {
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return {
    '--range-progress': `${Math.max(0, Math.min(100, progress))}%`,
  } as CSSProperties;
}

function VideoEditorInspector({
  clip,
  locked,
  probe,
  clipCount,
  timelineDuration,
  canvasSize,
  compositing,
  mixedSources,
  frameRate,
  onFrameRateChange,
  outputScale,
  onOutputScaleChange,
  onBeginInteraction,
  onEndInteraction,
  onTransformChange,
  onTransitionChange,
  onVolumeChange,
  onAddText,
  onPatchText,
  activeTab,
  onActiveTabChange,
  aiModels,
  aiTransitionBusy,
  aiTransitionStatus,
  aiTransitionError,
  canGenerateAiTransition,
  onRefreshAiModels,
  onGenerateAiTransition,
}: VideoEditorInspectorProps) {
  const [propertyTab, setPropertyTab] = useState<PropertyTab>('clip');
  const kept = clip ? getClipDuration(clip) : 0;
  const transform = clip?.transform ?? DEFAULT_TRANSFORM;
  const continuousEditHandlers = {
    onPointerDown: onBeginInteraction,
    onPointerUp: onEndInteraction,
    onPointerCancel: onEndInteraction,
    onKeyDown: onBeginInteraction,
    onKeyUp: onEndInteraction,
    onBlur: onEndInteraction,
  };

  const panelHead = (
    <div className="video-editor-panel-head video-editor-inspector-tabs" role="tablist" aria-label="视频编辑工具">
      {([
        ['properties', 'lucide:sliders-horizontal', '属性'],
        ['text', 'lucide:type', '文字'],
        ['transition', 'lucide:blend', '转场'],
      ] as const).map(([tab, icon, label]) => (
        <button
          type="button"
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          className={activeTab === tab ? 'active' : ''}
          onClick={() => onActiveTabChange(tab)}
        >
          <Icon icon={icon} width={13} height={13} />
          {label}
        </button>
      ))}
    </div>
  );

  if (activeTab === 'text') {
    return (
      <aside className="video-editor-inspector">
        {panelHead}
        <VideoEditorTextPanel
          selectedClip={clip}
          onAddText={onAddText}
          onPatchText={onPatchText}
          onBeginInteraction={onBeginInteraction}
          onEndInteraction={onEndInteraction}
        />
      </aside>
    );
  }

  if (activeTab === 'transition') {
    return (
      <aside className="video-editor-inspector">
        {panelHead}
        <VideoEditorTransitionPanel
          clip={clip}
          locked={locked}
          onTransitionChange={onTransitionChange}
          onBeginInteraction={onBeginInteraction}
          onEndInteraction={onEndInteraction}
          aiModels={aiModels}
          aiTransitionBusy={aiTransitionBusy}
          aiTransitionStatus={aiTransitionStatus}
          aiTransitionError={aiTransitionError}
          canGenerateAiTransition={canGenerateAiTransition}
          onRefreshAiModels={onRefreshAiModels}
          onGenerateAiTransition={onGenerateAiTransition}
        />
      </aside>
    );
  }

  const propertyTabs = ([
    ['clip', 'lucide:film', '片段'],
    ['transform', 'lucide:move-3d', '画面'],
    ['audio', 'lucide:audio-lines', '音频'],
    ['export', 'lucide:settings-2', '工程'],
  ] as const).filter(([tab]) => tab !== 'audio' || clip?.kind === 'video' || !!probe?.audioCodec);
  const resolvedPropertyTab = propertyTabs.some(([tab]) => tab === propertyTab)
    ? propertyTab
    : 'clip';

  return (
    <aside className="video-editor-inspector">
      {panelHead}

      <div className="video-editor-property-tabs" role="tablist" aria-label="属性分类">
        {propertyTabs.map(([tab, icon, label]) => (
          <button
            type="button"
            key={tab}
            role="tab"
            aria-selected={resolvedPropertyTab === tab}
            className={resolvedPropertyTab === tab ? 'active' : ''}
            onClick={() => setPropertyTab(tab)}
          >
            <Icon icon={icon} width={14} height={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {resolvedPropertyTab === 'clip' && (
        <>
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">时间轴</div>
        <div className="video-editor-inspect-row">
          <span>片段数</span><span>{clipCount}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>总时长</span><span>{timelineDuration.toFixed(2)}s</span>
        </div>
      </div>

      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">
          片段
          {locked && <span className="video-editor-inspect-badge">已锁定</span>}
        </div>
        <div className="video-editor-inspect-row">
          <span>名称</span>
          <span className="video-editor-inspect-ellipsis" title={clip?.fileName}>
            {clip?.fileName ?? '—'}
          </span>
        </div>
        <div className="video-editor-inspect-row">
          <span>类型</span>
          <span>{clip ? (clip.kind === 'image' ? '图片' : clip.kind === 'text' ? '文字' : '视频') : '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>入点</span><span>{clip ? `${clip.sourceIn.toFixed(2)}s` : '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>出点</span><span>{clip ? `${clip.sourceOut.toFixed(2)}s` : '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>保留时长</span><span>{clip ? `${kept.toFixed(2)}s` : '—'}</span>
        </div>
      </div>

      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">源素材</div>
        <div className="video-editor-inspect-row">
          <span>分辨率</span>
          <span>{probe ? `${probe.width}×${probe.height}` : '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>总时长</span><span>{probe ? `${probe.duration.toFixed(2)}s` : '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>视频编码</span><span>{probe?.videoCodec ?? '—'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>音频编码</span><span>{probe?.audioCodec ?? '—'}</span>
        </div>
      </div>
        </>
      )}

      {/* 画中画 / 贴纸层的摆放 */}
      {resolvedPropertyTab === 'transform' && (
        <>
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">画面变换</div>
        {([
          ['水平位置', 'x', 0, 1, 0.01],
          ['垂直位置', 'y', 0, 1, 0.01],
          ['缩放', 'scale', 0.05, 2, 0.01],
          ['旋转', 'rotation', -180, 180, 1],
          ['不透明度', 'opacity', 0, 1, 0.01],
        ] as const).map(([label, key, min, max, step]) => (
          <label key={key} className="video-editor-inspect-slider">
            <span>{label}</span>
            <input
              type="range"
              min={min} max={max} step={step}
              value={transform[key]}
              style={rangeProgress(transform[key], min, max)}
              disabled={!clip || locked}
              {...continuousEditHandlers}
              onChange={(event) => onTransformChange({ [key]: Number(event.target.value) })}
            />
            <em>{key === 'rotation' ? `${transform[key]}°` : transform[key].toFixed(2)}</em>
          </label>
        ))}
      </div>

        {PENDING_SECTIONS.map((section) => (
          <div key={section} className="video-editor-inspect-group pending">
            <div className="video-editor-inspect-title">
              {section}<span className="video-editor-inspect-badge">规划中</span>
            </div>
          </div>
        ))}
        </>
      )}

      {resolvedPropertyTab === 'audio' && (
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">音量</div>
        <label className="video-editor-inspect-slider">
          <span>片段增益</span>
          <input
            type="range" min={0} max={2} step={0.05}
            value={clip?.volume ?? 1}
            style={rangeProgress(clip?.volume ?? 1, 0, 2)}
            disabled={!clip || locked}
            {...continuousEditHandlers}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
          <em>{((clip?.volume ?? 1) * 100).toFixed(0)}%</em>
        </label>
      </div>
      )}

      {resolvedPropertyTab === 'export' && (
        <>
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">导出</div>
        <div className="video-editor-inspect-row">
          <span>方式</span>
          <span>{compositing ? '合成（重编码）' : '无损直通'}</span>
        </div>
        {mixedSources && (
          <div className="video-editor-inspect-hint">
            素材分辨率或编码不一致，无法直通拼接，将归一到同一画布导出。
          </div>
        )}
        <div className="video-editor-inspect-row">
          <span>画布</span><span>{canvasSize.width}×{canvasSize.height}</span>
        </div>
        <label className="video-editor-inspect-slider">
          <span>分辨率</span>
          <select
            value={outputScale}
            disabled={!compositing}
            onChange={(event) => onOutputScaleChange(Number(event.target.value))}
          >
            <option value={1}>原始</option>
            <option value={0.5}>50%</option>
            <option value={0.25}>25%</option>
          </select>
        </label>
        <label className="video-editor-inspect-slider">
          <span>帧率</span>
          <select
            value={frameRate}
            disabled={!compositing}
            onChange={(event) => onFrameRateChange(Number(event.target.value))}
          >
            {[24, 25, 30, 50, 60].map((fps) => (
              <option key={fps} value={fps}>{fps} fps</option>
            ))}
          </select>
        </label>
      </div>

      <VideoEditorCodecPanel />
        </>
      )}
    </aside>
  );
}

export default memo(VideoEditorInspector);

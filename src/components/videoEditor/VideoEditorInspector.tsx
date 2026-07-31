/**
 * VideoEditorInspector — 右侧属性检查器
 *
 * 一期只读展示选中片段与源素材信息；Transform / Appearance / Effects 等
 * 可编辑分组留到二期，分组骨架先按最终布局占位。
 */
import { memo } from 'react';
import VideoEditorCodecPanel from './VideoEditorCodecPanel';
import {
  DEFAULT_TRANSFORM,
  getClipDuration,
  type VideoEditorClip,
  type VideoEditorSourceProbe,
  type VideoEditorTransform,
  type VideoEditorTransitionKind,
} from '../../types/videoEditor';

interface VideoEditorInspectorProps {
  clip: VideoEditorClip | null;
  probe: VideoEditorSourceProbe | null;
  clipCount: number;
  timelineDuration: number;
  canvasSize: { width: number; height: number };
  compositing: boolean;
  frameRate: number;
  onFrameRateChange: (fps: number) => void;
  onTransformChange: (patch: Partial<VideoEditorTransform>) => void;
  onTransitionChange: (kind: VideoEditorTransitionKind, duration: number) => void;
  onVolumeChange: (volume: number) => void;
}

/** 二期开放的可编辑分组，先占位以固定布局 */
const PENDING_SECTIONS = ['滤镜', '文字与贴纸'];

function VideoEditorInspector({
  clip,
  probe,
  clipCount,
  timelineDuration,
  canvasSize,
  compositing,
  frameRate,
  onFrameRateChange,
  onTransformChange,
  onTransitionChange,
  onVolumeChange,
}: VideoEditorInspectorProps) {
  const kept = clip ? getClipDuration(clip) : 0;
  const transform = clip?.transform ?? DEFAULT_TRANSFORM;
  const transition = clip?.transitionIn ?? { kind: 'none' as const, duration: 0.5 };

  return (
    <aside className="video-editor-inspector">
      <div className="video-editor-panel-head">属性</div>

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
        <div className="video-editor-inspect-title">片段</div>
        <div className="video-editor-inspect-row">
          <span>名称</span>
          <span className="video-editor-inspect-ellipsis" title={clip?.fileName}>
            {clip?.fileName ?? '—'}
          </span>
        </div>
        <div className="video-editor-inspect-row">
          <span>类型</span><span>{clip ? (clip.kind === 'image' ? '图片' : '视频') : '—'}</span>
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

      {/* 画中画 / 贴纸层的摆放 */}
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">变换（叠加层）</div>
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
              disabled={!clip}
              onChange={(event) => onTransformChange({ [key]: Number(event.target.value) })}
            />
            <em>{key === 'rotation' ? `${transform[key]}°` : transform[key].toFixed(2)}</em>
          </label>
        ))}
      </div>

      {/* 与前一个片段之间的转场 */}
      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">转场（与前一段）</div>
        <label className="video-editor-inspect-slider">
          <span>类型</span>
          <select
            value={transition.kind}
            disabled={!clip}
            onChange={(event) => onTransitionChange(
              event.target.value as VideoEditorTransitionKind,
              transition.duration,
            )}
          >
            <option value="none">硬切</option>
            <option value="dissolve">交叠淡入</option>
            <option value="fade">黑场淡入</option>
          </select>
        </label>
        <label className="video-editor-inspect-slider">
          <span>时长</span>
          <input
            type="range" min={0.1} max={3} step={0.1}
            value={transition.duration}
            disabled={!clip || transition.kind === 'none'}
            onChange={(event) => onTransitionChange(transition.kind, Number(event.target.value))}
          />
          <em>{transition.duration.toFixed(1)}s</em>
        </label>
      </div>

      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">音量</div>
        <label className="video-editor-inspect-slider">
          <span>片段增益</span>
          <input
            type="range" min={0} max={2} step={0.05}
            value={clip?.volume ?? 1}
            disabled={!clip}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
          <em>{((clip?.volume ?? 1) * 100).toFixed(0)}%</em>
        </label>
      </div>

      <div className="video-editor-inspect-group">
        <div className="video-editor-inspect-title">导出</div>
        <div className="video-editor-inspect-row">
          <span>方式</span>
          <span>{compositing ? '合成（重编码）' : '无损直通'}</span>
        </div>
        <div className="video-editor-inspect-row">
          <span>画布</span><span>{canvasSize.width}×{canvasSize.height}</span>
        </div>
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

      {PENDING_SECTIONS.map((section) => (
        <div key={section} className="video-editor-inspect-group pending">
          <div className="video-editor-inspect-title">
            {section}<span className="video-editor-inspect-badge">二期</span>
          </div>
        </div>
      ))}
    </aside>
  );
}

export default memo(VideoEditorInspector);

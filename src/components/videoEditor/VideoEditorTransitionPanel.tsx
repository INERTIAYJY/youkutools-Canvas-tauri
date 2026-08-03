/**
 * VideoEditorTransitionPanel — 检查器的「转场」标签
 *
 * 转场作用于选中片段与它前一段之间：预设靠不透明度在本地合成，
 * AI 转场则把首尾帧交给视频模型生成一段真实过渡画面。
 */
import { memo, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import VideoEditorAiTransitionPanel from './VideoEditorAiTransitionPanel';
import type { VideoEditorModelOption } from '../../services/videoEditorWindowService';
import type { VideoEditorClip, VideoEditorTransitionKind } from '../../types/videoEditor';

interface VideoEditorTransitionPanelProps {
  clip: VideoEditorClip | null;
  locked: boolean;
  onTransitionChange: (kind: VideoEditorTransitionKind, duration: number) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
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

const MIN_TRANSITION_DURATION = 0.1;
const MAX_TRANSITION_DURATION = 3;

function VideoEditorTransitionPanel({
  clip,
  locked,
  onTransitionChange,
  onBeginInteraction,
  onEndInteraction,
  aiModels,
  aiTransitionBusy,
  aiTransitionStatus,
  aiTransitionError,
  canGenerateAiTransition,
  onRefreshAiModels,
  onGenerateAiTransition,
}: VideoEditorTransitionPanelProps) {
  const transition = clip?.transitionIn ?? { kind: 'none' as const, duration: 0.5 };
  const continuousEditHandlers = {
    onPointerDown: onBeginInteraction,
    onPointerUp: onEndInteraction,
    onPointerCancel: onEndInteraction,
    onKeyDown: onBeginInteraction,
    onKeyUp: onEndInteraction,
    onBlur: onEndInteraction,
  };
  const durationProgress = (
    (transition.duration - MIN_TRANSITION_DURATION)
    / (MAX_TRANSITION_DURATION - MIN_TRANSITION_DURATION)
  ) * 100;

  return (
    <div className="video-editor-inspect-group">
      <div className="video-editor-inspect-title">
        转场（与前一段）
        {locked && <span className="video-editor-inspect-badge">已锁定</span>}
      </div>

      {clip ? (
        <>
          <label className="video-editor-inspect-slider">
            <span>类型</span>
            <select
              value={transition.kind}
              disabled={locked}
              {...continuousEditHandlers}
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
              type="range"
              min={MIN_TRANSITION_DURATION}
              max={MAX_TRANSITION_DURATION}
              step={0.1}
              value={transition.duration}
              style={{
                '--range-progress': `${Math.max(0, Math.min(100, durationProgress))}%`,
              } as CSSProperties}
              disabled={locked || transition.kind === 'none'}
              {...continuousEditHandlers}
              onChange={(event) => onTransitionChange(transition.kind, Number(event.target.value))}
            />
            <em>{transition.duration.toFixed(1)}s</em>
          </label>

          <VideoEditorAiTransitionPanel
            models={aiModels}
            busy={aiTransitionBusy}
            status={aiTransitionStatus}
            error={aiTransitionError}
            canGenerate={canGenerateAiTransition}
            onRefreshModels={onRefreshAiModels}
            onGenerate={onGenerateAiTransition}
          />
        </>
      ) : (
        <div className="video-editor-layer-empty">
          <Icon icon="lucide:mouse-pointer-2" width={20} height={20} />
          <span>选中一个片段后设置它与前一段之间的转场</span>
        </div>
      )}
    </div>
  );
}

export default memo(VideoEditorTransitionPanel);

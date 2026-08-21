/**
 * VideoEditorRuler — 时间轴刻度尺与播放头手柄
 *
 * 刻度按当前缩放选步长（像素密度决定，而非总时长），因此放大后会自动
 * 细分到更小的单位。擦洗交由时间轴统一处理，保证与轨道共用同一套吸附。
 */
import { memo } from 'react';
import { buildTicks, formatTickLabel, pickTickStep } from './rulerTicks';
import { useT } from '../../i18n';

interface VideoEditorRulerProps {
  duration: number;
  playhead: number;
  pixelsPerSecond: number;
  onScrub: (event: React.PointerEvent) => void;
}

function VideoEditorRuler({
  duration,
  playhead,
  pixelsPerSecond,
  onScrub,
}: VideoEditorRulerProps) {
  const t = useT();
  const step = pickTickStep(duration, pixelsPerSecond);
  const ticks = buildTicks(duration, step);

  return (
    <div
      className="video-editor-ruler"
      onPointerDown={onScrub}
      role="slider"
      aria-label={t('播放头')}
      aria-valuenow={playhead}
      aria-valuemin={0}
      aria-valuemax={duration}
      tabIndex={0}
    >
      {ticks.map((tick, index) => (
        <span
          key={index}
          className={`video-editor-tick ${tick.major ? 'major' : ''}`}
          style={{ left: tick.time * pixelsPerSecond }}
        >
          {tick.major && tick.time > 0 && (
            <em className="video-editor-tick-label">{formatTickLabel(tick.time, step)}</em>
          )}
        </span>
      ))}

      <div
        className="video-editor-ruler-handle"
        style={{ left: playhead * pixelsPerSecond }}
      />
    </div>
  );
}

export default memo(VideoEditorRuler);

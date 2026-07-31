/**
 * VideoEditorTimeline — 多轨时间轴
 *
 * 视频轨是磁吸的：片段首尾相接，拖动即换序。支持缩放/横向滚动、
 * 边界吸附、框选多选、片段右键菜单和入点/出点裁剪。
 * 音频轨与字幕轨占位，二期启用。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  getClipDuration,
  type VideoEditorClip,
  type VideoEditorTrack,
} from '../../types/videoEditor';
import {
  clipEdges,
  clampZoom,
  dropIndexAt,
  fitZoom,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  snapTime,
} from './timelineOps';
import type { SourceState } from './useVideoEditorSources';
import VideoEditorRuler from './VideoEditorRuler';
import VideoEditorWaveform from './VideoEditorWaveform';

export interface ClipContextMenuState {
  clipId: string;
  x: number;
  y: number;
}

interface VideoEditorTimelineProps {
  tracks: VideoEditorTrack[];
  duration: number;
  playhead: number;
  selectedClipIds: string[];
  getSource: (clip: VideoEditorClip) => SourceState | undefined;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  onPlayheadChange: (time: number) => void;
  onSelectClips: (clipIds: string[]) => void;
  onTrimClip: (clipId: string, sourceIn: number, sourceOut: number) => void;
  onMoveClip: (clipId: string, targetIndex: number) => void;
  onSplit: () => void;
  onDeleteSelected: () => void;
  onDuplicateClip: (clipId: string) => void;
  onTracksChange: (tracks: VideoEditorTrack[]) => void;
  onAddTrack: (kind: 'video' | 'audio') => void;
  onRemoveTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: -1 | 1) => void;
  onBeginInteraction: () => void;
  canSplit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** 裁剪时片段最短保留时长，避免拖成零长 */
const MIN_CLIP_DURATION = 0.1;
/** 认定为「拖动」而非「点击」的像素阈值 */
const DRAG_THRESHOLD_PX = 4;

const TRACK_KIND_ICON: Record<string, string> = {
  video: '🎬',
  audio: '🔊',
  caption: '💬',
};

/** 取片段区间内的缩略图：整条缩略图带按素材总时长均分 */
function clipThumbnails(clip: VideoEditorClip, source: SourceState | undefined): string[] {
  if (!source) return [];
  if (clip.kind === 'image') return source.thumbnails;
  const total = source.probe?.duration ?? 0;
  if (total <= 0 || source.thumbnails.length === 0) return [];
  const from = Math.floor((clip.sourceIn / total) * source.thumbnails.length);
  const to = Math.ceil((clip.sourceOut / total) * source.thumbnails.length);
  return source.thumbnails.slice(Math.max(0, from), Math.max(from + 1, to));
}

function VideoEditorTimeline({
  tracks,
  duration,
  playhead,
  selectedClipIds,
  getSource,
  snapEnabled,
  onToggleSnap,
  onPlayheadChange,
  onSelectClips,
  onTrimClip,
  onMoveClip,
  onSplit,
  onDeleteSelected,
  onDuplicateClip,
  onTracksChange,
  onAddTrack,
  onRemoveTrack,
  onMoveTrack,
  onBeginInteraction,
  canSplit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: VideoEditorTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
  const [autoFit, setAutoFit] = useState(true);
  // offsetPx 让被拖片段跟手；没有它，磁吸重排下拖动几乎没有视觉反馈
  const [dragging, setDragging] = useState<
    { clipId: string; index: number; offsetPx: number } | null
  >(null);
  const [clipMenu, setClipMenu] = useState<ClipContextMenuState | null>(null);

  const videoTrack = tracks.find((track) => track.kind === 'video');
  const clips = useMemo(() => videoTrack?.clips ?? [], [videoTrack]);
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const soleSelected = selectedClipIds.length === 1
    ? clips.find((clip) => clip.id === selectedClipIds[0]) ?? null
    : null;

  const laneWidth = Math.max(0, duration * pixelsPerSecond);

  // 插入指示线的位置：移除被拖片段后，前 index 段的时长累计
  const dropIndicatorPx = useMemo(() => {
    if (!dragging) return null;
    const others = clips.filter((clip) => clip.id !== dragging.clipId);
    let seconds = 0;
    for (let i = 0; i < Math.min(dragging.index, others.length); i += 1) {
      seconds += getClipDuration(others[i]);
    }
    return seconds * pixelsPerSecond;
  }, [clips, dragging, pixelsPerSecond]);

  // 首次布局与窗口尺寸变化时铺满可用宽度，用户手动缩放后不再接管
  useLayoutEffect(() => {
    if (!autoFit) return;
    const element = scrollRef.current;
    if (!element || duration <= 0) return;
    const apply = () => setPixelsPerSecond(fitZoom(duration, element.clientWidth - 24));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [autoFit, duration]);

  const timeFromClientX = useCallback((clientX: number): number => {
    const element = scrollRef.current;
    if (!element || pixelsPerSecond <= 0) return 0;
    const rect = element.getBoundingClientRect();
    const x = clientX - rect.left + element.scrollLeft;
    return Math.min(duration, Math.max(0, x / pixelsPerSecond));
  }, [duration, pixelsPerSecond]);

  const applySnap = useCallback((time: number, exceptClipId?: string): number => {
    if (!snapEnabled) return time;
    const candidates = clipEdges(
      exceptClipId ? clips.filter((clip) => clip.id !== exceptClipId) : clips,
    );
    candidates.push(playhead);
    return snapTime(time, candidates, pixelsPerSecond);
  }, [clips, pixelsPerSecond, playhead, snapEnabled]);

  // Ctrl/⌘ + 滚轮缩放，以光标处的时间为锚点
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchorTime = (event.clientX - rect.left + element.scrollLeft) / pixelsPerSecond;
      const next = clampZoom(pixelsPerSecond * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
      setAutoFit(false);
      setPixelsPerSecond(next);
      // 保持光标下的时间点不动
      requestAnimationFrame(() => {
        element.scrollLeft = anchorTime * next - (event.clientX - rect.left);
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [pixelsPerSecond]);

  // 点击别处关掉片段右键菜单
  useEffect(() => {
    if (!clipMenu) return;
    const close = () => setClipMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [clipMenu]);

  const startScrub = useCallback((event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    onPlayheadChange(applySnap(timeFromClientX(event.clientX)));

    const onMove = (moveEvent: PointerEvent) => {
      onPlayheadChange(applySnap(timeFromClientX(moveEvent.clientX)));
    };
    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }, [applySnap, onPlayheadChange, timeFromClientX]);

  const startTrim = useCallback((
    clip: VideoEditorClip,
    mode: 'in' | 'out',
    event: React.PointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    onBeginInteraction();

    const apply = (clientX: number) => {
      const time = applySnap(timeFromClientX(clientX), clip.id);
      // 手柄位置是时间轴坐标，换算回素材坐标才能改入点/出点
      const sourceTime = clip.sourceIn + (time - clip.timelineStart);
      if (mode === 'in') {
        onTrimClip(
          clip.id,
          Math.max(0, Math.min(sourceTime, clip.sourceOut - MIN_CLIP_DURATION)),
          clip.sourceOut,
        );
      } else {
        onTrimClip(clip.id, clip.sourceIn, Math.max(sourceTime, clip.sourceIn + MIN_CLIP_DURATION));
      }
    };

    const onMove = (moveEvent: PointerEvent) => apply(moveEvent.clientX);
    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }, [applySnap, onBeginInteraction, onTrimClip, timeFromClientX]);

  const startClipDrag = useCallback((clip: VideoEditorClip, event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const originX = event.clientX;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let moved = false;
    let committed = false;

    const onMove = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - originX) < DRAG_THRESHOLD_PX) return;
      if (!moved) {
        moved = true;
        onSelectClips([clip.id]);
      }
      const index = dropIndexAt(clips, timeFromClientX(moveEvent.clientX), clip.id);
      setDragging({ clipId: clip.id, index, offsetPx: moveEvent.clientX - originX });
    };

    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);

      if (moved) {
        const index = dropIndexAt(clips, timeFromClientX(upEvent.clientX), clip.id);
        if (!committed) {
          committed = true;
          onBeginInteraction();
        }
        onMoveClip(clip.id, index);
      } else if (additive) {
        // 加选/减选
        onSelectClips(
          selectedSet.has(clip.id)
            ? selectedClipIds.filter((id) => id !== clip.id)
            : [...selectedClipIds, clip.id],
        );
      } else {
        onSelectClips([clip.id]);
      }
      setDragging(null);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }, [
    clips, onBeginInteraction, onMoveClip, onSelectClips,
    selectedClipIds, selectedSet, timeFromClientX,
  ]);

  const toggleTrackFlag = useCallback((trackId: string, flag: 'muted' | 'locked' | 'hidden') => {
    onTracksChange(tracks.map((track) => (
      track.id === trackId ? { ...track, [flag]: !track[flag] } : track
    )));
  }, [onTracksChange, tracks]);

  const zoomBy = useCallback((factor: number) => {
    setAutoFit(false);
    setPixelsPerSecond((current) => clampZoom(current * factor));
  }, []);

  return (
    <section className="video-editor-timeline">
      <div className="video-editor-timeline-head">
        <span className="video-editor-timeline-title">时间轴</span>

        <div className="video-editor-toolgroup">
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={onUndo} disabled={!canUndo} data-tooltip="撤销 Ctrl+Z"
          >
            <Icon icon="lucide:undo-2" width={13} height={13} />
          </button>
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={onRedo} disabled={!canRedo} data-tooltip="重做 Ctrl+Shift+Z"
          >
            <Icon icon="lucide:redo-2" width={13} height={13} />
          </button>
        </div>

        <div className="video-editor-toolgroup">
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={onSplit} disabled={!canSplit} data-tooltip="在播放头处分割 S"
          >
            <Icon icon="lucide:scissors" width={13} height={13} />分割
          </button>
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={() => soleSelected && onDuplicateClip(soleSelected.id)}
            disabled={!soleSelected} data-tooltip="复制片段 Ctrl+D"
          >
            <Icon icon="lucide:copy" width={13} height={13} />
          </button>
          <button
            type="button" className="video-editor-timeline-btn danger"
            onClick={onDeleteSelected}
            disabled={selectedClipIds.length === 0 || clips.length <= selectedClipIds.length}
            data-tooltip="删除选中片段 Del"
          >
            <Icon icon="lucide:trash-2" width={13} height={13} />
          </button>
        </div>

        <button
          type="button"
          className={`video-editor-timeline-btn ${snapEnabled ? 'active' : ''}`}
          onClick={onToggleSnap}
          data-tooltip="边界吸附"
        >
          <Icon icon="lucide:magnet" width={13} height={13} />
        </button>

        <div className="video-editor-toolgroup">
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={() => onAddTrack('video')} data-tooltip="新增叠加轨（画中画 / 贴纸）"
          >
            <Icon icon="lucide:layers" width={13} height={13} />叠加轨
          </button>
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={() => onAddTrack('audio')} data-tooltip="新增音频轨"
          >
            <Icon icon="lucide:audio-lines" width={13} height={13} />音频轨
          </button>
        </div>

        {soleSelected && (
          <span className="video-editor-timeline-range">
            {soleSelected.fileName} · {soleSelected.sourceIn.toFixed(2)}–
            {soleSelected.sourceOut.toFixed(2)}s · 时长 {getClipDuration(soleSelected).toFixed(2)}s
          </span>
        )}
        {selectedClipIds.length > 1 && (
          <span className="video-editor-timeline-range">
            已选中 {selectedClipIds.length} 个片段
          </span>
        )}

        <div className="video-editor-zoom">
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={() => zoomBy(1 / 1.4)} data-tooltip="缩小"
          >
            <Icon icon="lucide:zoom-out" width={13} height={13} />
          </button>
          <input
            type="range"
            min={MIN_PIXELS_PER_SECOND}
            max={MAX_PIXELS_PER_SECOND}
            value={pixelsPerSecond}
            onChange={(event) => {
              setAutoFit(false);
              setPixelsPerSecond(Number(event.target.value));
            }}
            aria-label="时间轴缩放"
          />
          <button
            type="button" className="video-editor-timeline-btn"
            onClick={() => zoomBy(1.4)} data-tooltip="放大"
          >
            <Icon icon="lucide:zoom-in" width={13} height={13} />
          </button>
          <button
            type="button"
            className={`video-editor-timeline-btn ${autoFit ? 'active' : ''}`}
            onClick={() => setAutoFit(true)}
            data-tooltip="适应窗口"
          >
            <Icon icon="lucide:move-horizontal" width={13} height={13} />
          </button>
        </div>
      </div>

      <div className="video-editor-timeline-body">
        <div className="video-editor-track-labels">
          <div className="video-editor-ruler-spacer" />
          {tracks.map((track) => (
            <div key={track.id} className="video-editor-track-label">
              <span className="video-editor-track-icon">{TRACK_KIND_ICON[track.kind] ?? '🎞'}</span>
              <span className="video-editor-track-name">{track.name}</span>
              <button
                type="button"
                className={`video-editor-track-flag ${track.muted ? 'active' : ''}`}
                onClick={() => toggleTrackFlag(track.id, 'muted')}
                data-tooltip={track.muted ? '取消静音' : '静音'}
              >M</button>
              <button
                type="button"
                className={`video-editor-track-flag ${track.locked ? 'active' : ''}`}
                onClick={() => toggleTrackFlag(track.id, 'locked')}
                data-tooltip={track.locked ? '解锁轨道' : '锁定轨道'}
              >
                <Icon icon={track.locked ? 'lucide:lock' : 'lucide:unlock'} width={10} height={10} />
              </button>
              <button
                type="button"
                className={`video-editor-track-flag ${track.hidden ? 'active' : ''}`}
                onClick={() => toggleTrackFlag(track.id, 'hidden')}
                data-tooltip={track.hidden ? '显示轨道' : '隐藏轨道'}
              >
                <Icon icon={track.hidden ? 'lucide:eye-off' : 'lucide:eye'} width={10} height={10} />
              </button>
              {track.overlay || track.kind === 'audio' ? (
                <>
                  <button
                    type="button" className="video-editor-track-flag"
                    onClick={() => onMoveTrack(track.id, 1)} data-tooltip="上移一层"
                  >
                    <Icon icon="lucide:chevron-up" width={10} height={10} />
                  </button>
                  <button
                    type="button" className="video-editor-track-flag danger"
                    onClick={() => onRemoveTrack(track.id)} data-tooltip="删除轨道"
                  >
                    <Icon icon="lucide:x" width={10} height={10} />
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>

        <div className="video-editor-scroll" ref={scrollRef}>
          <div className="video-editor-canvas" style={{ width: laneWidth }}>
            <VideoEditorRuler
              duration={duration}
              playhead={playhead}
              pixelsPerSecond={pixelsPerSecond}
              onScrub={startScrub}
            />

            {tracks.map((track) => (
              <div
                key={track.id}
                className={`video-editor-track-lane ${track.locked ? 'locked' : ''}`}
                onPointerDown={(event) => {
                  if (track.kind !== 'video') return;
                  onSelectClips([]);
                  startScrub(event);
                }}
              >
                {track.kind === 'video' ? track.clips.map((clip) => {
                  const isSelected = selectedSet.has(clip.id);
                  const isDragging = dragging?.clipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={[
                        'video-editor-clip',
                        clip.kind,
                        isSelected ? 'selected' : '',
                        isDragging ? 'dragging' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        left: clip.timelineStart * pixelsPerSecond,
                        width: Math.max(2, getClipDuration(clip) * pixelsPerSecond),
                        transform: isDragging ? `translateX(${dragging.offsetPx}px)` : undefined,
                      }}
                      onPointerDown={(event) => {
                        if (track.locked) return;
                        startClipDrag(clip, event);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!isSelected) onSelectClips([clip.id]);
                        setClipMenu({ clipId: clip.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <div className="video-editor-clip-thumbs">
                        {clipThumbnails(clip, getSource(clip)).map((thumbnail, thumbIndex) => (
                          thumbnail
                            ? <img key={thumbIndex} src={thumbnail} alt="" draggable={false} />
                            : <span key={thumbIndex} className="video-editor-thumb-blank" />
                        ))}
                      </div>
                      <span className="video-editor-clip-name">{clip.fileName}</span>

                      {isSelected && !track.locked && (
                        <>
                          <div
                            className="video-editor-trim-handle in"
                            onPointerDown={(event) => startTrim(clip, 'in', event)}
                            role="slider" aria-label="入点"
                            aria-valuenow={clip.sourceIn} aria-valuemin={0} aria-valuemax={duration}
                            tabIndex={0}
                          />
                          <div
                            className="video-editor-trim-handle out"
                            onPointerDown={(event) => startTrim(clip, 'out', event)}
                            role="slider" aria-label="出点"
                            aria-valuenow={clip.sourceOut} aria-valuemin={0} aria-valuemax={duration}
                            tabIndex={0}
                          />
                        </>
                      )}
                    </div>
                  );
                }) : track.kind === 'audio' ? track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`video-editor-clip audio ${selectedSet.has(clip.id) ? 'selected' : ''}`}
                    style={{
                      left: clip.timelineStart * pixelsPerSecond,
                      width: Math.max(2, getClipDuration(clip) * pixelsPerSecond),
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectClips([clip.id]);
                    }}
                  >
                    <VideoEditorWaveform peaks={getSource(clip)?.waveform ?? []} />
                    <span className="video-editor-clip-name">{clip.fileName}</span>
                  </div>
                )) : (
                  <div className="video-editor-track-placeholder">字幕轨二期开放</div>
                )}

                {track.kind === 'video' && dropIndicatorPx !== null && (
                  <div className="video-editor-drop-indicator" style={{ left: dropIndicatorPx }} />
                )}
              </div>
            ))}

            <div
              className="video-editor-playhead"
              style={{ left: playhead * pixelsPerSecond }}
            />
          </div>
        </div>
      </div>

      {clipMenu && (
        <div
          className="video-editor-clip-menu"
          style={{ left: clipMenu.x, top: clipMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onSplit(); setClipMenu(null); }} disabled={!canSplit}>
            在播放头分割<span>S</span>
          </button>
          <button type="button" onClick={() => { onDuplicateClip(clipMenu.clipId); setClipMenu(null); }}>
            复制片段<span>Ctrl D</span>
          </button>
          <button
            type="button" className="danger"
            onClick={() => { onDeleteSelected(); setClipMenu(null); }}
            disabled={clips.length <= selectedClipIds.length}
          >
            删除<span>Del</span>
          </button>
        </div>
      )}
    </section>
  );
}

export default memo(VideoEditorTimeline);

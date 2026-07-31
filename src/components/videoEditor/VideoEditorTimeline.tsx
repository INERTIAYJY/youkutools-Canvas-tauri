/**
 * VideoEditorTimeline — 多轨时间轴
 *
 * 视频轨是磁吸的：片段首尾相接，拖动即换序。支持缩放/横向滚动、
 * 边界吸附、框选多选、片段右键菜单和入点/出点裁剪。
 * 片段可在轨道间拖拽：主轨 ←→ 叠加轨自由移动。
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
  /** 跨轨道移动片段：position 在主轨=序号，在叠加轨=时间轴时间 */
  onMoveClipToTrack: (clipId: string, sourceTrackId: string, targetTrackId: string, position: number) => void;
  /** 叠加轨内移动：更新时间轴位置 */
  onMoveClipInOverlay: (clipId: string, trackId: string, timelineStart: number) => void;
  /** 拖到空白区域时创建新轨道并把片段放进去 */
  onCreateTrackAndMove: (clipId: string, sourceTrackId: string, timelineStart: number) => void;
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

/** 轨道颜色映射（剪映风格的轨道区分） */
const TRACK_COLORS = [
  'var(--track-color-1, #6366f1)',
  'var(--track-color-2, #22c55e)',
  'var(--track-color-3, #f59e0b)',
  'var(--track-color-4, #3b82f6)',
  'var(--track-color-5, #ec4899)',
  'var(--track-color-6, #14b8a6)',
];
function trackAccent(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

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
  onMoveClipToTrack,
  onMoveClipInOverlay,
  onCreateTrackAndMove,
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
  // 拖拽状态：记录源轨道、目标轨道和在目标轨中的位置
  const [dragging, setDragging] = useState<{
    clipId: string;
    sourceTrackId: string;
    targetTrackId: string;
    /** 在主轨中 = 插入序号；在叠加轨中 = 时间轴时间 */
    position: number;
    offsetPx: number;
    offsetY: number;
  } | null>(null);
  const [clipMenu, setClipMenu] = useState<ClipContextMenuState | null>(null);

  const videoTrack = tracks.find((track) => track.kind === 'video');
  const clips = useMemo(() => videoTrack?.clips ?? [], [videoTrack]);
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  // 在所有视频轨中查找片段
  const allVideoClips = useMemo(() => {
    const result: { clip: VideoEditorClip; trackId: string }[] = [];
    for (const track of tracks) {
      if (track.kind !== 'video') continue;
      for (const clip of track.clips) {
        result.push({ clip, trackId: track.id });
      }
    }
    return result;
  }, [tracks]);

  const soleSelected = useMemo(() => {
    const found = allVideoClips.find(({ clip }) => clip.id === selectedClipIds[0]);
    return found?.clip ?? null;
  }, [allVideoClips, selectedClipIds]);

  const laneWidth = Math.max(0, duration * pixelsPerSecond);

  // 插入指示线：主轨磁吸排序时用序号算位置，叠加轨直接按时间算
  const dropIndicatorPx = useMemo(() => {
    if (!dragging) return null;
    const targetTrack = tracks.find((t) => t.id === dragging.targetTrackId);
    if (!targetTrack || targetTrack.overlay) {
      // 叠加轨：直接按时间轴坐标
      return dragging.position * pixelsPerSecond;
    }
    // 主轨：按序号累计时长
    const targetClips = targetTrack.clips.filter((c) => c.id !== dragging.clipId);
    let seconds = 0;
    for (let i = 0; i < Math.min(dragging.position, targetClips.length); i += 1) {
      seconds += getClipDuration(targetClips[i]);
    }
    return seconds * pixelsPerSecond;
  }, [dragging, pixelsPerSecond, tracks]);

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
    // 收集所有视频轨片段边沿作为吸附候选
    const allEdges: number[] = [0];
    for (const track of tracks) {
      if (track.kind !== 'video') continue;
      for (const clip of track.clips) {
        if (clip.id === exceptClipId) continue;
        allEdges.push(clip.timelineStart);
        allEdges.push(clip.timelineStart + getClipDuration(clip));
      }
    }
    allEdges.push(playhead);
    return snapTime(time, [...new Set(allEdges)].sort((a, b) => a - b), pixelsPerSecond);
  }, [pixelsPerSecond, playhead, snapEnabled, tracks]);

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

  const startClipDrag = useCallback((clip: VideoEditorClip, sourceTrackId: string, event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const originX = event.clientX;
    const originY = event.clientY;
    // 按下时鼠标相对于片段左边缘的像素偏移，松手时用它反算片段头部应落在的时间
    const clipRect = target.getBoundingClientRect();
    const grabOffsetX = originX - clipRect.left;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let moved = false;
    let committed = false;
    const sourceTrack = tracks.find((t) => t.id === sourceTrackId);
    const isSourceOverlay = sourceTrack?.overlay ?? false;

    /** 根据鼠标 Y 坐标判断落在哪条视频轨，返回 null 表示在轨道下方空白区 */
    const resolveTargetTrack = (clientY: number): string | null => {
      const videoTracks = tracks.filter((t) => t.kind === 'video' && !t.locked);
      if (videoTracks.length === 0) return null;
      // 找最后一个轨道的底部边界
      let lastTrackBottom = 0;
      for (const vt of videoTracks) {
        const el = document.querySelector(`[data-track-id="${vt.id}"]`) as HTMLElement | null;
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom > lastTrackBottom) lastTrackBottom = rect.bottom;
        if (clientY >= rect.top && clientY <= rect.bottom) return vt.id;
      }
      // 在最后一个轨道下方 → 触发新建轨道
      if (clientY > lastTrackBottom) return null;
      // 在所有轨道上方 → 回退到源轨道
      return sourceTrackId;
    };

    /** 用片段左边缘 X 反算时间轴时间，松手时片段头部不跳 */
    const clipLeftTimeFromClientX = (clientX: number): number => {
      const element = scrollRef.current;
      if (!element || pixelsPerSecond <= 0) return 0;
      const scrollRect = element.getBoundingClientRect();
      const clipLeftX = clientX - grabOffsetX;
      const x = clipLeftX - scrollRect.left + element.scrollLeft;
      return Math.min(duration, Math.max(0, x / pixelsPerSecond));
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - originX) < DRAG_THRESHOLD_PX
        && Math.abs(moveEvent.clientY - originY) < DRAG_THRESHOLD_PX) return;
      if (!moved) {
        moved = true;
        onSelectClips([clip.id]);
      }

      const targetTrackId = resolveTargetTrack(moveEvent.clientY);
      const time = clipLeftTimeFromClientX(moveEvent.clientX);

      if (targetTrackId === null) {
        // 拖到空白区域，显示为新轨道
        const snappedTime = applySnap(time, clip.id);
        setDragging({
          clipId: clip.id, sourceTrackId,
          targetTrackId: '__new__', position: snappedTime,
          offsetPx: moveEvent.clientX - originX,
          offsetY: moveEvent.clientY - originY,
        });
        return;
      }

      const targetTrack = tracks.find((t) => t.id === targetTrackId);
      const snappedTime = applySnap(time, clip.id);

      if (targetTrack?.overlay) {
        setDragging({
          clipId: clip.id, sourceTrackId,
          targetTrackId, position: snappedTime,
          offsetPx: moveEvent.clientX - originX,
          offsetY: moveEvent.clientY - originY,
        });
      } else {
        const targetClips = targetTrack?.clips ?? [];
        const index = dropIndexAt(targetClips, time, clip.id);
        setDragging({
          clipId: clip.id, sourceTrackId,
          targetTrackId, position: index,
          offsetPx: moveEvent.clientX - originX,
          offsetY: moveEvent.clientY - originY,
        });
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);

      if (moved) {
        const targetTrackId = resolveTargetTrack(upEvent.clientY);
        const time = clipLeftTimeFromClientX(upEvent.clientX);

        if (!committed) {
          committed = true;
          onBeginInteraction();
        }

        if (targetTrackId === null) {
          // 拖到空白区域 → 创建新轨道
          const snappedTime = applySnap(time, clip.id);
          onCreateTrackAndMove(clip.id, sourceTrackId, snappedTime);
        } else if (targetTrackId !== sourceTrackId) {
          const targetTrack = tracks.find((t) => t.id === targetTrackId);
          if (targetTrack?.overlay) {
            const snappedTime = applySnap(time, clip.id);
            onMoveClipToTrack(clip.id, sourceTrackId, targetTrackId, snappedTime);
          } else {
            const targetClips = targetTrack?.clips ?? [];
            const index = dropIndexAt(targetClips, time, clip.id);
            onMoveClipToTrack(clip.id, sourceTrackId, targetTrackId, index);
          }
        } else if (isSourceOverlay) {
          const snappedTime = applySnap(time, clip.id);
          onMoveClipInOverlay(clip.id, sourceTrackId, snappedTime);
        } else {
          const sourceClips = sourceTrack?.clips ?? [];
          const index = dropIndexAt(sourceClips, time, clip.id);
          onMoveClip(clip.id, index);
        }
      } else if (additive) {
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
    applySnap, duration, onBeginInteraction, onCreateTrackAndMove, onMoveClip,
    onMoveClipInOverlay, onMoveClipToTrack, onSelectClips, pixelsPerSecond,
    selectedClipIds, selectedSet, tracks,
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

      <div className={`video-editor-timeline-body ${dragging ? 'dragging' : ''}`}>
        <div className="video-editor-track-labels">
          <div className="video-editor-ruler-spacer" />
          {tracks.map((track, trackIndex) => (
            <div
              key={track.id}
              className="video-editor-track-label"
              style={{
                borderLeft: track.kind === 'video' && !track.overlay
                  ? `3px solid ${trackAccent(trackIndex)}` : undefined,
              }}
            >
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
                data-track-id={track.id}
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
                  const duration = getClipDuration(clip);
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
                        width: Math.max(2, duration * pixelsPerSecond),
                        transform: isDragging ? `translate(${dragging.offsetPx}px, ${dragging.offsetY}px)` : undefined,
                      }}
                      onPointerDown={(event) => {
                        if (track.locked) return;
                        startClipDrag(clip, track.id, event);
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
                      {/* 片段名称叠加在缩略图上 */}
                      <span className="video-editor-clip-name">{clip.fileName}</span>
                      {/* hover 信息浮层：时长 */}
                      <span className="video-editor-clip-hover">
                        {duration.toFixed(1)}s
                      </span>

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

                {track.kind === 'video' && dropIndicatorPx !== null && dragging?.targetTrackId === track.id && (
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

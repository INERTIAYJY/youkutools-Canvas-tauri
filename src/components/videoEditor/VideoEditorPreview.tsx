/**
 * VideoEditorPreview — 预览区与走带控制
 *
 * 主轨用 WebView 原生 <video> 播放（吃系统解码器，稳定），
 * 叠加轨片段以绝对定位 div 叠在画面上，可直接拖拽移动、缩放、旋转。
 *
 * 播放头是「时间轴坐标」，这里负责换算到当前片段的素材坐标，
 * 播到片段末尾就把播放头推进到下一段，由父组件切换活动片段。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { computeDrawRect } from '../../services/videoCompositor';
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  getActiveClips,
  getClipDuration,
  getOverlayTracks,
  getVideoTrack,
  type VideoEditorClip,
  type VideoEditorTrack,
  type VideoEditorTransform,
} from '../../types/videoEditor';
import { resolveClipUrl } from './useVideoEditorSources';

interface VideoEditorPreviewProps {
  clip: VideoEditorClip | null;
  clipUrl: string;
  playhead: number;
  timelineDuration: number;
  /** 全部轨道，用于渲染叠加层 */
  tracks: VideoEditorTrack[];
  /** 选中片段 ID，用于在画面上高亮叠加层 */
  selectedClipIds: string[];
  /** 画布尺寸，用于计算叠加层归一化坐标到像素的映射 */
  canvasSize: { width: number; height: number };
  /** 当前主素材的原始尺寸；与导出合成共用 contain + transform 计算 */
  sourceSize?: { width: number; height: number } | null;
  onPlayheadChange: (time: number) => void;
  onSelectClips: (clipIds: string[]) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
  /** 修改叠加层片段的 transform */
  onTransformChange: (clipId: string, patch: Partial<VideoEditorTransform>) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** 缩放手柄的位置 */
type HandlePos = 'nw' | 'ne' | 'sw' | 'se';

interface OverlayMediaProps {
  clip: VideoEditorClip;
  playhead: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  canvasDisplayScale: number;
}

/**
 * 叠加视频拥有独立媒体元素，但时间由主轨播放头统一驱动。
 * 静音可避免多轨预览时重复出声，也允许 WebView 自动跟播。
 */
function OverlayMedia({ clip, playhead, playing, muted, volume, canvasDisplayScale }: OverlayMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = resolveClipUrl(clip);
  const failed = !!url && failedUrl === url;
  const sourceTime = clip.sourceIn + (playhead - clip.timelineStart);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip.kind !== 'video') return;
    if (Math.abs(video.currentTime - sourceTime) > 0.05) {
      video.currentTime = Math.max(0, sourceTime);
    }
  }, [clip.kind, sourceTime, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip.kind !== 'video' || failed) return;
    if (playing) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [clip.kind, failed, playing, url]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  if (clip.kind === 'text') {
    const textStyle = { ...DEFAULT_TEXT_STYLE, ...clip.textStyle };
    return (
      <div
        className="video-editor-overlay-text"
        style={{
          color: textStyle.color,
          fontFamily: textStyle.fontFamily,
          fontSize: `${Math.max(8, textStyle.fontSize * canvasDisplayScale)}px`,
          fontWeight: textStyle.fontWeight,
          textAlign: textStyle.align,
        }}
      >
        {textStyle.content || DEFAULT_TEXT_STYLE.content}
      </div>
    );
  }

  if (!url || failed) {
    return <div className="video-editor-stage-empty">素材无法预览</div>;
  }

  if (clip.kind === 'image') {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className="video-editor-overlay-img"
        onError={() => setFailedUrl(url)}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={url}
      className="video-editor-overlay-img"
      preload="auto"
      muted={muted}
      playsInline
      onError={() => setFailedUrl(url)}
    />
  );
}

interface AudioPreviewProps {
  clip: VideoEditorClip;
  playhead: number;
  playing: boolean;
  muted: boolean;
  volume: number;
}

/** 音频轨走带：由统一播放头定位，播放状态与主走带保持一致。 */
function AudioPreview({ clip, playhead, playing, muted, volume }: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const url = resolveClipUrl(clip);
  const sourceTime = clip.sourceIn + (playhead - clip.timelineStart);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Math.abs(audio.currentTime - sourceTime) > 0.05) {
      audio.currentTime = Math.max(0, sourceTime);
    }
  }, [sourceTime, url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) void audio.play().catch(() => {});
    else audio.pause();
  }, [playing, url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  if (!url) return null;
  return <audio ref={audioRef} src={url} preload="auto" muted={muted} />;
}

function VideoEditorPreview({
  clip,
  clipUrl,
  playhead,
  timelineDuration,
  tracks,
  selectedClipIds,
  canvasSize,
  sourceSize,
  onPlayheadChange,
  onSelectClips,
  onBeginInteraction,
  onEndInteraction,
  onTransformChange,
}: VideoEditorPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [canvasDisplayScale, setCanvasDisplayScale] = useState(1);
  const [stageContentSize, setStageContentSize] = useState({ width: 0, height: 0 });
  // 由播放推动的时间更新不该再写回 video.currentTime，否则会打断播放
  const drivenByPlayback = useRef(false);
  // 叠加层拖拽状态
  const [dragOverlay, setDragOverlay] = useState<{
    clipId: string;
    mode: 'move' | 'scale';
    handle?: HandlePos;
    startClientX: number;
    startClientY: number;
    startTransform: VideoEditorTransform;
    frameRect: DOMRect;
  } | null>(null);

  const clipEnd = clip ? clip.timelineStart + getClipDuration(clip) : 0;
  const sourceTime = clip ? clip.sourceIn + (playhead - clip.timelineStart) : 0;
  const mainTrack = useMemo(() => getVideoTrack(tracks), [tracks]);
  const mainTrackHidden = mainTrack?.hidden === true;
  const mainTrackMuted = mainTrack?.muted === true || mainTrackHidden;
  const mainVolume = (mainTrack?.volume ?? 1) * (clip?.volume ?? 1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const styles = window.getComputedStyle(stage);
      const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0)
        + (Number.parseFloat(styles.paddingRight) || 0);
      const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0)
        + (Number.parseFloat(styles.paddingBottom) || 0);
      setStageContentSize({
        width: Math.max(0, stage.clientWidth - horizontalPadding),
        height: Math.max(0, stage.clientHeight - verticalPadding),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = canvasFrameRef.current;
    if (!frame || canvasSize.width <= 0) return;
    const update = () => setCanvasDisplayScale(frame.clientWidth / canvasSize.width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [canvasSize.width]);

  // 外部拖动播放头 → 同步到 video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || clip.kind !== 'video' || drivenByPlayback.current) return;
    if (Math.abs(video.currentTime - sourceTime) > 0.05) {
      video.currentTime = sourceTime;
    }
  }, [clip, sourceTime]);

  const playheadRef = useRef(playhead);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  const advanceTo = useCallback((nextPlayhead: number) => {
    if (nextPlayhead < clipEnd - 0.001) {
      onPlayheadChange(nextPlayhead);
      return;
    }
    if (clipEnd >= timelineDuration - 0.001) {
      videoRef.current?.pause();
      setPlaying(false);
      onPlayheadChange(timelineDuration);
      return;
    }
    onPlayheadChange(clipEnd + 0.001);
  }, [clipEnd, onPlayheadChange, timelineDuration]);

  useEffect(() => {
    if (!playing || clip?.kind !== 'image') return;
    const timer = setInterval(() => advanceTo(playheadRef.current + 0.1), 100);
    return () => clearInterval(timer);
  }, [advanceTo, clip?.kind, playing]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    drivenByPlayback.current = true;
    advanceTo(clip.timelineStart + (video.currentTime - clip.sourceIn));
    drivenByPlayback.current = false;
  }, [advanceTo, clip]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (playing) {
      video?.pause();
      setPlaying(false);
      return;
    }
    if (playhead >= timelineDuration - 0.01) onPlayheadChange(0);
    setPlaying(true);
    if (clip?.kind === 'video') {
      void video?.play().catch(() => setPlaying(false));
    }
  }, [clip?.kind, onPlayheadChange, playhead, playing, timelineDuration]);

  // 剪辑软件的播放控制是高频动作：在非输入区域按空格即可播放/暂停。
  // 键盘操作保持即时，不附加额外动画或延迟。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      togglePlay();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip?.kind !== 'video') return;
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [clip?.kind, clipUrl, playing]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, mainVolume));
  }, [mainVolume]);

  const step = useCallback((direction: 1 | -1) => {
    setPlaying(false);
    videoRef.current?.pause();
    onPlayheadChange(Math.min(timelineDuration, Math.max(0, playhead + direction / 30)));
  }, [onPlayheadChange, playhead, timelineDuration]);

  // ── 叠加层拖拽 ──
  const overlayTracks = useMemo(
    () => getOverlayTracks(tracks).filter((track) => track.kind === 'video'),
    [tracks],
  );
  const activeOverlays = useMemo(() => {
    const result: { clip: VideoEditorClip; track: VideoEditorTrack }[] = [];
    for (const track of overlayTracks) {
      if (track.hidden) continue;
      for (const c of getActiveClips(track, playhead)) {
        result.push({ clip: c, track });
      }
    }
    return result;
  }, [overlayTracks, playhead]);
  const activeAudio = useMemo(() => {
    const result: { clip: VideoEditorClip; track: VideoEditorTrack }[] = [];
    for (const track of tracks) {
      if (track.kind !== 'audio' || track.hidden) continue;
      for (const activeClip of getActiveClips(track, playhead)) {
        result.push({ clip: activeClip, track });
      }
    }
    return result;
  }, [playhead, tracks]);

  const startOverlayInteraction = useCallback((
    overlayClip: VideoEditorClip,
    mode: 'move' | 'scale',
    event: React.PointerEvent,
    handle?: HandlePos,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const frame = canvasFrameRef.current;
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();
    onBeginInteraction();
    setDragOverlay({
      clipId: overlayClip.id,
      mode,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTransform: overlayClip.transform ?? DEFAULT_TRANSFORM,
      frameRect,
    });
    onSelectClips([overlayClip.id]);
  }, [onBeginInteraction, onSelectClips]);

  useEffect(() => {
    if (!dragOverlay) return;
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - dragOverlay.startClientX;
      const dy = moveEvent.clientY - dragOverlay.startClientY;
      const { width: frameW, height: frameH } = dragOverlay.frameRect;

      if (dragOverlay.mode === 'move') {
        const dxN = dx / frameW;
        const dyN = dy / frameH;
        onTransformChange(dragOverlay.clipId, {
          x: Math.max(0, Math.min(1, dragOverlay.startTransform.x + dxN)),
          y: Math.max(0, Math.min(1, dragOverlay.startTransform.y + dyN)),
        });
      } else if (dragOverlay.mode === 'scale' && dragOverlay.handle) {
        const centerX = dragOverlay.startTransform.x * frameW;
        const centerY = dragOverlay.startTransform.y * frameH;
        const startDistX = dragOverlay.startClientX - centerX;
        const startDistY = dragOverlay.startClientY - centerY;
        const startDist = Math.sqrt(startDistX * startDistX + startDistY * startDistY);
        const newDist = Math.sqrt(
          (moveEvent.clientX - centerX) ** 2 + (moveEvent.clientY - centerY) ** 2,
        );
        if (startDist > 4) {
          const ratio = newDist / startDist;
          onTransformChange(dragOverlay.clipId, {
            scale: Math.max(0.05, Math.min(5, dragOverlay.startTransform.scale * ratio)),
          });
        }
      }
    };
    const finish = () => {
      setDragOverlay(null);
      onEndInteraction();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
    };
  }, [dragOverlay, onEndInteraction, onTransformChange]);

  // ── 进度条 ──
  const startScrub = useCallback((event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const apply = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onPlayheadChange(ratio * timelineDuration);
    };
    apply(event.clientX);
    target.setPointerCapture(event.pointerId);
    const onMove = (moveEvent: PointerEvent) => apply(moveEvent.clientX);
    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }, [onPlayheadChange, timelineDuration]);

  const progressPct = timelineDuration > 0 ? (playhead / timelineDuration) * 100 : 0;

  const stageInfo = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;
    return `${canvasSize.width}×${canvasSize.height}`;
  }, [canvasSize]);

  // 画布宽高比作为 canvas-frame 的 aspect-ratio
  const canvasAspect = canvasSize.width > 0 && canvasSize.height > 0
    ? `${canvasSize.width} / ${canvasSize.height}`
    : '16 / 9';

  const canvasFrameStyle = useMemo<CSSProperties>(() => {
    if (
      canvasSize.width <= 0
      || canvasSize.height <= 0
      || stageContentSize.width <= 0
      || stageContentSize.height <= 0
    ) {
      return { aspectRatio: canvasAspect };
    }
    const fit = Math.min(
      stageContentSize.width / canvasSize.width,
      stageContentSize.height / canvasSize.height,
    );
    return {
      aspectRatio: canvasAspect,
      width: `${canvasSize.width * fit}px`,
      height: `${canvasSize.height * fit}px`,
    };
  }, [canvasAspect, canvasSize.height, canvasSize.width, stageContentSize]);

  // 主轨与导出都通过 computeDrawRect 计算 contain、位置和缩放，避免预览/成片偏差。
  const mainMediaStyle = useMemo<CSSProperties>(() => {
    const transform = clip?.transform ?? DEFAULT_TRANSFORM;
    const resolvedSourceSize = sourceSize && sourceSize.width > 0 && sourceSize.height > 0
      ? sourceSize
      : canvasSize;
    const rect = computeDrawRect(resolvedSourceSize, canvasSize, transform);
    return {
      left: `${(rect.x / Math.max(1, canvasSize.width)) * 100}%`,
      top: `${(rect.y / Math.max(1, canvasSize.height)) * 100}%`,
      width: `${(rect.width / Math.max(1, canvasSize.width)) * 100}%`,
      height: `${(rect.height / Math.max(1, canvasSize.height)) * 100}%`,
      opacity: mainTrackHidden ? 0 : transform.opacity,
      transform: `rotate(${transform.rotation}deg)`,
    };
  }, [canvasSize, clip?.transform, mainTrackHidden, sourceSize]);

  return (
    <section className="video-editor-preview">
      <div
        ref={stageRef}
        className={`video-editor-stage ${playing ? 'playing' : ''}`}
      >
        <div
          ref={canvasFrameRef}
          className="video-editor-canvas-frame"
          style={canvasFrameStyle}
          aria-label={stageInfo ? `输出画布 ${stageInfo}` : '输出画布'}
        >
          {/* 主轨画面：背景 + video/img 居中 */}
          {!clip || !clipUrl ? (
            <div className="video-editor-stage-empty">无可预览的素材</div>
          ) : clip.kind === 'image' ? (
            <img
              src={clipUrl}
              className={`video-editor-video ${mainTrackHidden ? 'track-hidden' : ''}`}
              style={mainMediaStyle}
              alt=""
              draggable={false}
            />
          ) : (
            <video
              ref={videoRef}
              src={clipUrl}
              className={`video-editor-video ${mainTrackHidden ? 'track-hidden' : ''}`}
              style={mainMediaStyle}
              onTimeUpdate={handleTimeUpdate}
              onPause={() => { if (!playing) setPlaying(false); }}
              preload="auto"
              muted={mainTrackMuted}
            />
          )}
          {mainTrackHidden && (
            <div className="video-editor-stage-empty">主视频轨已隐藏</div>
          )}

          {/* 叠加层片段：绝对定位在画布之上，可直接拖拽编辑 */}
          {activeOverlays.map(({ clip: overlayClip, track }) => {
            const transform = overlayClip.transform ?? DEFAULT_TRANSFORM;
            const isSelected = selectedClipIds.includes(overlayClip.id);
            const locked = track.locked === true;
            const isText = overlayClip.kind === 'text';
            return (
              <div
                key={overlayClip.id}
                className={[
                  'video-editor-overlay',
                  isText ? 'text' : '',
                  isSelected ? 'selected' : '',
                  locked ? 'locked' : '',
                ].filter(Boolean).join(' ')}
                style={isText ? {
                  left: `${transform.x * 100}%`,
                  top: `${transform.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${transform.scale})`,
                  opacity: transform.opacity,
                } : {
                  left: `${transform.x * 100}%`,
                  top: `${transform.y * 100}%`,
                  width: `${transform.scale * 100}%`,
                  height: `${transform.scale * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
                  opacity: transform.opacity,
                }}
                onPointerDown={locked
                  ? (event) => {
                    event.stopPropagation();
                    onSelectClips([overlayClip.id]);
                  }
                  : (event) => startOverlayInteraction(overlayClip, 'move', event)}
              >
                <OverlayMedia
                  clip={overlayClip}
                  playhead={playhead}
                  playing={playing}
                  muted={track.muted === true}
                  volume={(track.volume ?? 1) * (overlayClip.volume ?? 1)}
                  canvasDisplayScale={canvasDisplayScale}
                />
                {isSelected && !locked && (
                  <>
                    {(['nw', 'ne', 'sw', 'se'] as HandlePos[]).map((pos) => (
                      <div
                        key={pos}
                        className={`video-editor-overlay-handle ${pos}`}
                        onPointerDown={(event) => startOverlayInteraction(overlayClip, 'scale', event, pos)}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}

          {activeAudio.map(({ clip: audioClip, track }) => (
            <AudioPreview
              key={`${track.id}:${audioClip.id}`}
              clip={audioClip}
              playhead={playhead}
              playing={playing}
              muted={track.muted === true}
              volume={(track.volume ?? 1) * (audioClip.volume ?? 1)}
            />
          ))}

          {/* 点击空白区域取消选中 */}
          <div
            className="video-editor-stage-passthrough"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                onSelectClips([]);
              }
            }}
          />
        </div>
      </div>

      {stageInfo && (
        <div className="video-editor-stage-info">
          <span className="video-editor-canvas-size-label">输出画布</span>
          <span>{stageInfo}</span>
          {activeOverlays.length > 0 && (
            <span className="dim">· {activeOverlays.length} 个叠加层</span>
          )}
        </div>
      )}

      <div
        className="video-editor-progress-bar"
        onPointerDown={startScrub}
      >
        <div className="video-editor-progress-fill" style={{ width: `${progressPct}%` }} />
        <div className="video-editor-progress-thumb" style={{ left: `${progressPct}%` }} />
      </div>

      <div className="video-editor-transport">
        <button type="button" className="video-editor-transport-btn" onClick={() => step(-1)} aria-label="上一帧">
          <Icon icon="lucide:chevron-first" width={16} height={16} />
        </button>
        <button
          type="button"
          className="video-editor-transport-btn primary"
          onClick={togglePlay}
          aria-label={playing ? '暂停' : '播放'}
          aria-keyshortcuts="Space"
          data-tooltip={playing ? '暂停 Space' : '播放 Space'}
        >
          <Icon icon={playing ? 'lucide:pause' : 'lucide:play'} width={16} height={16} />
        </button>
        <button type="button" className="video-editor-transport-btn" onClick={() => step(1)} aria-label="下一帧">
          <Icon icon="lucide:chevron-last" width={16} height={16} />
        </button>
        <span className="video-editor-timecode">
          {formatTime(playhead)} <span className="dim">/ {formatTime(timelineDuration)}</span>
        </span>
        <span className="video-editor-shortcut-hint" aria-hidden="true">
          <kbd>Space</kbd> 播放
        </span>
      </div>
    </section>
  );
}

export default memo(VideoEditorPreview);

/**
 * VideoEditorPreview — 预览区与走带控制
 *
 * 预览用 WebView 原生 <video>：吃系统解码器，比逐帧驱动 canvas 更稳，
 * 也避开了 WKWebView / WebView2 之间 WebCodecs 解码器覆盖不一致的问题。
 *
 * 播放头是「时间轴坐标」，这里负责换算到当前片段的素材坐标，
 * 播到片段末尾就把播放头推进到下一段，由父组件切换活动片段。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { getClipDuration, type VideoEditorClip } from '../../types/videoEditor';

interface VideoEditorPreviewProps {
  clip: VideoEditorClip | null;
  clipUrl: string;
  playhead: number;
  timelineDuration: number;
  onPlayheadChange: (time: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function VideoEditorPreview({
  clip,
  clipUrl,
  playhead,
  timelineDuration,
  onPlayheadChange,
}: VideoEditorPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // 由播放推动的时间更新不该再写回 video.currentTime，否则会打断播放
  const drivenByPlayback = useRef(false);

  const clipEnd = clip ? clip.timelineStart + getClipDuration(clip) : 0;
  const sourceTime = clip ? clip.sourceIn + (playhead - clip.timelineStart) : 0;

  // 外部拖动播放头 → 同步到 video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || clip.kind !== 'video' || drivenByPlayback.current) return;
    if (Math.abs(video.currentTime - sourceTime) > 0.05) {
      video.currentTime = sourceTime;
    }
  }, [clip, sourceTime]);

  // 定时器回调里要读到最新播放头，用 ref 避免每 100ms 重建定时器
  const playheadRef = useRef(playhead);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  /**
   * 推进播放头。走到片段末尾时跨到下一段（父组件据此切换活动片段），
   * 整条时间轴放完则停下。由真正驱动时间的回调调用，不放在 effect 体里。
   */
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

  // 图片片段没有 timeupdate，播放时用定时器推进播放头
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
    // 停在整条时间轴末尾时再次播放，从头开始
    if (playhead >= timelineDuration - 0.01) onPlayheadChange(0);
    setPlaying(true);
    if (clip?.kind === 'video') {
      void video?.play().catch(() => setPlaying(false));
    }
  }, [clip?.kind, onPlayheadChange, playhead, playing, timelineDuration]);

  // 切换到视频片段且处于播放态时自动接着播
  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip?.kind !== 'video') return;
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [clip?.kind, clipUrl, playing]);

  const step = useCallback((direction: 1 | -1) => {
    setPlaying(false);
    videoRef.current?.pause();
    // 没有逐帧 API，按 30fps 估一步
    onPlayheadChange(Math.min(timelineDuration, Math.max(0, playhead + direction / 30)));
  }, [onPlayheadChange, playhead, timelineDuration]);

  return (
    <section className="video-editor-preview">
      <div className="video-editor-stage">
        {!clip || !clipUrl ? (
          <div className="video-editor-stage-empty">无可预览的素材</div>
        ) : clip.kind === 'image' ? (
          <img src={clipUrl} className="video-editor-video" alt="" draggable={false} />
        ) : (
          <video
            ref={videoRef}
            src={clipUrl}
            className="video-editor-video"
            onTimeUpdate={handleTimeUpdate}
            onPause={() => { if (!playing) setPlaying(false); }}
            preload="auto"
          />
        )}
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
        >
          <Icon icon={playing ? 'lucide:pause' : 'lucide:play'} width={16} height={16} />
        </button>
        <button type="button" className="video-editor-transport-btn" onClick={() => step(1)} aria-label="下一帧">
          <Icon icon="lucide:chevron-last" width={16} height={16} />
        </button>
        <span className="video-editor-timecode">
          {formatTime(playhead)} <span className="dim">/ {formatTime(timelineDuration)}</span>
        </span>
      </div>
    </section>
  );
}

export default memo(VideoEditorPreview);

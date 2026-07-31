/**
 * VideoEditorWaveform — 音频片段上的波形。
 *
 * 用 SVG polyline 画峰值包络：桶数远少于样本数，因此不需要 canvas，
 * 也能随片段宽度自适应拉伸。
 */
import { memo } from 'react';

function VideoEditorWaveform({ peaks }: { peaks: number[] }) {
  if (peaks.length === 0) {
    return <div className="video-editor-waveform-empty">解析波形中…</div>;
  }

  // 上下对称的包络：viewBox 用 0–100 归一化，交给 CSS 拉伸到片段宽度
  const step = 100 / Math.max(1, peaks.length - 1);
  const top = peaks.map((peak, index) => `${index * step},${50 - peak * 48}`).join(' ');
  const bottom = peaks
    .map((peak, index) => `${(peaks.length - 1 - index) * step},${50 + peak * 48}`)
    .reverse()
    .join(' ');

  return (
    <svg className="video-editor-waveform" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon points={`${top} ${bottom}`} />
    </svg>
  );
}

export default memo(VideoEditorWaveform);

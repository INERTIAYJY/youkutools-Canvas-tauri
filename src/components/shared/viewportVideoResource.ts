/**
 * viewportVideoResource — 释放视口视频元素占用的媒体资源。
 */
export function releaseViewportVideoElement(video: Pick<
  HTMLVideoElement,
  'pause' | 'removeAttribute' | 'load'
> | null): void {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

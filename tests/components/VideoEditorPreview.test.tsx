import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import VideoEditorPreview from '../../src/components/videoEditor/VideoEditorPreview';
import type { VideoEditorClip, VideoEditorTrack } from '../../src/types/videoEditor';

function clip(overrides: Partial<VideoEditorClip>): VideoEditorClip {
  return {
    id: 'clip-main',
    kind: 'video',
    sourceUrl: 'https://example.test/main.mp4',
    fileName: 'main.mp4',
    timelineStart: 0,
    sourceIn: 0,
    sourceOut: 4,
    ...overrides,
  };
}

function renderPreview(overlayClip: VideoEditorClip): string {
  const mainClip = clip({});
  const tracks: VideoEditorTrack[] = [
    { id: 'main', kind: 'video', name: '主轨', clips: [mainClip] },
    { id: 'overlay', kind: 'video', name: '叠加轨', overlay: true, clips: [overlayClip] },
  ];

  return renderToStaticMarkup(
    <VideoEditorPreview
      clip={mainClip}
      clipUrl={mainClip.sourceUrl ?? ''}
      playhead={1}
      timelineDuration={4}
      tracks={tracks}
      selectedClipIds={[overlayClip.id]}
      canvasSize={{ width: 1280, height: 720 }}
      onPlayheadChange={vi.fn()}
      onSelectClips={vi.fn()}
      onBeginInteraction={vi.fn()}
      onEndInteraction={vi.fn()}
      onTransformChange={vi.fn()}
    />,
  );
}

describe('VideoEditorPreview overlays', () => {
  it('renders an active overlay video as a native video element', () => {
    const html = renderPreview(clip({
      id: 'clip-overlay-video',
      sourceUrl: 'https://example.test/overlay.mp4',
    }));

    expect(html).toContain('src="https://example.test/overlay.mp4"');
    expect(html).toContain('<video');
    expect(html).not.toContain('src="https://example.test/overlay.mp4" alt=""');
  });

  it('keeps an active overlay image as an image element', () => {
    const html = renderPreview(clip({
      id: 'clip-overlay-image',
      kind: 'image',
      sourceUrl: 'https://example.test/overlay.png',
      fileName: 'overlay.png',
    }));

    expect(html).toContain('<img src="https://example.test/overlay.png"');
  });
});

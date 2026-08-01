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

function renderTracks(tracks: VideoEditorTrack[], mainClip: VideoEditorClip): string {
  return renderToStaticMarkup(
    <VideoEditorPreview
      clip={mainClip}
      clipUrl={mainClip.sourceUrl ?? ''}
      playhead={1}
      timelineDuration={4}
      tracks={tracks}
      selectedClipIds={tracks.flatMap((track) => track.clips.map((entry) => entry.id))}
      canvasSize={{ width: 1280, height: 720 }}
      onPlayheadChange={vi.fn()}
      onSelectClips={vi.fn()}
      onBeginInteraction={vi.fn()}
      onEndInteraction={vi.fn()}
      onTransformChange={vi.fn()}
    />,
  );
}

function renderPreview(overlayClip: VideoEditorClip, trackPatch: Partial<VideoEditorTrack> = {}): string {
  const mainClip = clip({});
  return renderTracks([
    { id: 'main', kind: 'video', name: '主轨', clips: [mainClip] },
    { id: 'overlay', kind: 'video', name: '叠加轨', overlay: true, clips: [overlayClip], ...trackPatch },
  ], mainClip);
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

  it('renders an active text clip without requiring a media URL', () => {
    const html = renderPreview(clip({
      id: 'clip-overlay-text',
      kind: 'text',
      sourceUrl: undefined,
      fileName: '片头标题',
      textStyle: {
        content: '片头标题',
        fontSize: 72,
        color: '#ffdd88',
        fontWeight: 700,
        align: 'center',
      },
    }));

    expect(html).toContain('video-editor-overlay text selected');
    expect(html).toContain('video-editor-overlay-text');
    expect(html).toContain('片头标题');
    expect(html).not.toContain('素材无法预览');
  });

  it('mutes the main media when its track is muted and hides its picture when hidden', () => {
    const mainClip = clip({});
    const html = renderTracks([
      { id: 'main', kind: 'video', name: '主轨', muted: true, hidden: true, clips: [mainClip] },
    ], mainClip);

    expect(html).toMatch(/<video[^>]*class="video-editor-video track-hidden"[^>]*muted/);
  });

  it('uses the overlay track mute state and removes transform handles when locked', () => {
    const html = renderPreview(clip({
      id: 'clip-overlay-video',
      sourceUrl: 'https://example.test/overlay.mp4',
    }), { muted: true, locked: true });

    expect(html).toMatch(/<video[^>]*src="https:\/\/example\.test\/overlay\.mp4"[^>]*muted/);
    expect(html).toContain('video-editor-overlay selected locked');
    expect(html).not.toContain('video-editor-overlay-handle');
  });

  it('renders active audio-track clips as synchronized audio elements', () => {
    const mainClip = clip({});
    const audioClip = clip({
      id: 'clip-audio',
      sourceUrl: 'https://example.test/audio.mp4',
    });
    const html = renderTracks([
      { id: 'main', kind: 'video', name: '主轨', clips: [mainClip] },
      { id: 'audio', kind: 'audio', name: '音频轨', clips: [audioClip] },
    ], mainClip);

    expect(html).toContain('<audio src="https://example.test/audio.mp4"');
  });
});

/**
 * VideoEditorMediaPanel — 左侧素材列表
 *
 * 列出时间轴上的全部片段，点选即选中对应片段；二期接项目资产面板的拖入。
 */
import { memo } from 'react';
import { Icon } from '@iconify/react';
import { getClipDuration, type VideoEditorClip } from '../../types/videoEditor';
import type { SourceState } from './useVideoEditorSources';

interface VideoEditorMediaPanelProps {
  clips: VideoEditorClip[];
  getSource: (clip: VideoEditorClip) => SourceState | undefined;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
}

function VideoEditorMediaPanel({
  clips,
  getSource,
  selectedClipId,
  onSelectClip,
}: VideoEditorMediaPanelProps) {
  const undecodable = clips.filter((clip) => {
    const source = getSource(clip);
    return clip.kind === 'video' && source?.probe && !source.probe.decodable;
  });
  const failed = clips.filter((clip) => getSource(clip)?.error);

  return (
    <aside className="video-editor-media">
      <div className="video-editor-panel-head">素材 · {clips.length}</div>
      <div className="video-editor-media-list">
        {clips.length === 0 && (
          <div className="video-editor-panel-empty">工程内暂无素材</div>
        )}
        {clips.map((clip, index) => {
          const source = getSource(clip);
          const poster = clip.kind === 'image' ? clip.sourceUrl : source?.thumbnails[0];
          return (
            <button
              key={clip.id}
              type="button"
              className={`video-editor-media-item ${clip.id === selectedClipId ? 'selected' : ''}`}
              onClick={() => onSelectClip(clip.id)}
            >
              <div className="video-editor-media-thumb">
                {poster
                  ? <img src={poster} alt="" draggable={false} />
                  : <Icon icon={clip.kind === 'image' ? 'lucide:image' : 'lucide:film'} width={18} height={18} />}
              </div>
              <div className="video-editor-media-info">
                <span className="video-editor-media-name" title={clip.fileName}>
                  {index + 1}. {clip.fileName}
                </span>
                <span className="video-editor-media-sub">
                  {clip.kind === 'image' ? '图片' : '视频'} · {getClipDuration(clip).toFixed(1)}s
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {undecodable.length > 0 && (
        <div className="video-editor-panel-warning">
          有 {undecodable.length} 个片段当前系统无法解码，缩略图不可用；直通裁剪导出仍可进行。
        </div>
      )}
      {failed.length > 0 && (
        <div className="video-editor-panel-warning">
          有 {failed.length} 个片段读取失败：{getSource(failed[0])?.error}
        </div>
      )}
    </aside>
  );
}

export default memo(VideoEditorMediaPanel);

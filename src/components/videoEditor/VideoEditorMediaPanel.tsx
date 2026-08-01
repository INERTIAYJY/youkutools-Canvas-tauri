/**
 * VideoEditorMediaPanel — 左侧素材列表
 *
 * 列出时间轴上的全部片段，并可从素材库、本机或画布图片节点继续添加。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { AssetFileEntry } from '../../services/fileService';
import { getClipDuration, type VideoEditorClip } from '../../types/videoEditor';
import type { VideoEditorProjectImageSource } from '../../types/videoEditor';
import type { SourceState } from './useVideoEditorSources';

type MediaFilter = 'all' | 'video' | 'image';

interface VideoEditorMediaPanelProps {
  clips: VideoEditorClip[];
  getSource: (clip: VideoEditorClip) => SourceState | undefined;
  selectedClipId: string | null;
  libraryAssets: AssetFileEntry[];
  projectImages: VideoEditorProjectImageSource[];
  addingMedia: boolean;
  onSelectClip: (clipId: string) => void;
  onAddLocal: () => void;
  onAddLibraryAsset: (asset: AssetFileEntry) => void;
  onAddCanvasImage: (image: VideoEditorProjectImageSource) => void;
}

function VideoEditorMediaPanel({
  clips,
  getSource,
  selectedClipId,
  libraryAssets,
  projectImages,
  addingMedia,
  onSelectClip,
  onAddLocal,
  onAddLibraryAsset,
  onAddCanvasImage,
}: VideoEditorMediaPanelProps) {
  const [addMenu, setAddMenu] = useState<'closed' | 'root' | 'library' | 'canvas'>('closed');
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [mediaQuery, setMediaQuery] = useState('');
  const addMenuRef = useRef<HTMLDivElement>(null);
  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return libraryAssets;
    return libraryAssets.filter((asset) => asset.name.toLocaleLowerCase().includes(normalized));
  }, [libraryAssets, query]);
  const filteredImages = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projectImages;
    return projectImages.filter((image) => image.label.toLocaleLowerCase().includes(normalized));
  }, [projectImages, query]);

  useEffect(() => {
    if (addMenu === 'closed') return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenu('closed');
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenu('closed');
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [addMenu]);

  const undecodable = clips.filter((clip) => {
    const source = getSource(clip);
    return clip.kind === 'video' && source?.probe && !source.probe.decodable;
  });
  const failed = clips.filter((clip) => getSource(clip)?.error);
  const visibleClips = useMemo(() => {
    const normalized = mediaQuery.trim().toLocaleLowerCase();
    return clips.filter((clip) => (
      (mediaFilter === 'all' || clip.kind === mediaFilter)
      && (!normalized || clip.fileName.toLocaleLowerCase().includes(normalized))
    ));
  }, [clips, mediaFilter, mediaQuery]);

  return (
    <aside className="video-editor-media">
      <div className="video-editor-panel-head video-editor-media-head">
        <span>素材 · {clips.length}</span>
        <div ref={addMenuRef} className="video-editor-media-add-wrap">
          <button
            type="button"
            className="video-editor-media-add"
            aria-label={addingMedia ? '正在添加素材' : '添加素材'}
            aria-expanded={addMenu !== 'closed'}
            disabled={addingMedia}
            onClick={() => {
              setQuery('');
              setAddMenu((current) => current === 'closed' ? 'root' : 'closed');
            }}
          >
            <Icon icon={addingMedia ? 'lucide:loader-circle' : 'lucide:plus'} width={15} height={15} />
          </button>

          {addMenu !== 'closed' && (
            <div className="video-editor-media-add-menu">
              {addMenu === 'root' ? (
                <div className="video-editor-media-add-sources">
                  <button type="button" onClick={() => setAddMenu('library')}>
                    <Icon icon="lucide:library" width={16} height={16} />
                    <span><strong>素材库</strong><em>{libraryAssets.length} 个可用素材</em></span>
                    <Icon icon="lucide:chevron-right" width={14} height={14} />
                  </button>
                  <button
                    type="button"
                    disabled={addingMedia}
                    onClick={() => {
                      onAddLocal();
                      setAddMenu('closed');
                    }}
                  >
                    <Icon icon={addingMedia ? 'lucide:loader-circle' : 'lucide:hard-drive-upload'} width={16} height={16} />
                    <span><strong>{addingMedia ? '正在导入…' : '本机文件'}</strong><em>视频或图片</em></span>
                  </button>
                  <button type="button" onClick={() => setAddMenu('canvas')}>
                    <Icon icon="lucide:workflow" width={16} height={16} />
                    <span><strong>画布图片节点</strong><em>{projectImages.length} 张图片</em></span>
                    <Icon icon="lucide:chevron-right" width={14} height={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="video-editor-media-picker-head">
                    <button type="button" onClick={() => { setQuery(''); setAddMenu('root'); }} aria-label="返回">
                      <Icon icon="lucide:arrow-left" width={14} height={14} />
                    </button>
                    <strong>{addMenu === 'library' ? '素材库' : '画布图片节点'}</strong>
                  </div>
                  <label className="video-editor-media-search">
                    <Icon icon="lucide:search" width={13} height={13} />
                    <input
                      autoFocus
                      value={query}
                      placeholder="搜索素材"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div className="video-editor-media-picker-list">
                    {addMenu === 'library' ? filteredAssets.map((asset) => (
                      <button
                        type="button"
                        key={asset.assetId ?? asset.path}
                        onClick={() => { onAddLibraryAsset(asset); setAddMenu('closed'); }}
                      >
                        <span className="video-editor-media-picker-thumb">
                          {asset.category === 'image' && asset.assetUrl
                            ? <img src={asset.assetUrl} alt="" loading="lazy" />
                            : <Icon icon={asset.category === 'image' ? 'lucide:image' : 'lucide:film'} width={16} height={16} />}
                        </span>
                        <span><strong>{asset.name}</strong><em>{asset.category === 'image' ? '图片' : '视频'}</em></span>
                        <Icon icon="lucide:plus" width={14} height={14} />
                      </button>
                    )) : filteredImages.map((image) => (
                      <button
                        type="button"
                        key={image.nodeId}
                        onClick={() => { onAddCanvasImage(image); setAddMenu('closed'); }}
                      >
                        <span className="video-editor-media-picker-thumb">
                          <img src={image.sourceUrl} alt="" loading="lazy" />
                        </span>
                        <span><strong>{image.label}</strong><em>画布图片</em></span>
                        <Icon icon="lucide:plus" width={14} height={14} />
                      </button>
                    ))}
                    {((addMenu === 'library' && filteredAssets.length === 0)
                      || (addMenu === 'canvas' && filteredImages.length === 0)) && (
                      <div className="video-editor-media-picker-empty">没有可用素材</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="video-editor-media-tools">
        <div className="video-editor-media-filters" role="tablist" aria-label="素材类型">
          {([
            ['all', '全部'],
            ['video', '视频'],
            ['image', '图片'],
          ] as const).map(([filter, label]) => (
            <button
              type="button"
              key={filter}
              role="tab"
              aria-selected={mediaFilter === filter}
              className={mediaFilter === filter ? 'active' : ''}
              onClick={() => setMediaFilter(filter)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="video-editor-media-list-search">
          <Icon icon="lucide:search" width={13} height={13} />
          <input
            value={mediaQuery}
            placeholder="搜索工程素材"
            onChange={(event) => setMediaQuery(event.target.value)}
          />
          {mediaQuery && (
            <button type="button" onClick={() => setMediaQuery('')} aria-label="清空搜索">
              <Icon icon="lucide:x" width={12} height={12} />
            </button>
          )}
        </label>
      </div>
      <div className="video-editor-media-list">
        {visibleClips.length === 0 && (
          <div className="video-editor-panel-empty">
            {clips.length === 0 ? '工程内暂无素材' : '没有匹配的素材'}
          </div>
        )}
        {visibleClips.map((clip) => {
          const sourceIndex = clips.findIndex((candidate) => candidate.id === clip.id);
          const source = getSource(clip);
          const poster = clip.kind === 'image' ? clip.sourceUrl : source?.thumbnails[0];
          return (
            <button
              key={clip.id}
              type="button"
              draggable
              className={`video-editor-media-item ${clip.id === selectedClipId ? 'selected' : ''}`}
              onClick={() => onSelectClip(clip.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-video-editor-clip-id', clip.id);
                event.dataTransfer.setData('text/plain', clip.id);
              }}
            >
              <div className="video-editor-media-thumb">
                {poster
                  ? <img src={poster} alt="" draggable={false} />
                  : <Icon icon={clip.kind === 'image' ? 'lucide:image' : 'lucide:film'} width={18} height={18} />}
              </div>
              <div className="video-editor-media-info">
                <span className="video-editor-media-name" title={clip.fileName}>
                  {sourceIndex + 1}. {clip.fileName}
                </span>
                <span className="video-editor-media-sub">
                  {clip.kind === 'image' ? '图片' : '视频'} · {getClipDuration(clip).toFixed(1)}s
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {visibleClips.length > 0 && (
        <div className="video-editor-media-drag-hint">
          <Icon icon="lucide:mouse-pointer-2" width={12} height={12} />
          拖动素材到时间轴可调整位置与层级
        </div>
      )}

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

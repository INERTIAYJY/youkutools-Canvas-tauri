/**
 * VideoNode 视频节点 — 在画布上渲染视频内容，支持上传本地视频、播放控制、连接其他节点
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { BaseNodeData } from '../../types';
import NodeLabel from './shared/NodeLabel';
import NodeError from './shared/NodeError';
import GooeyBtn from './shared/GooeyBtn';
import ResizeHandle from './shared/ResizeHandle';
import VideoNodeControls from './shared/VideoNodeControls';
import VideoNodeToolbar, { type CaptureFramePosition } from './shared/VideoNodeToolbar';
import FullscreenOverlay from '../shared/FullscreenOverlay';
import { useNodeRename } from './shared/useNodeRename';
import { useSourceFileUpload } from './shared/useSourceFileUpload';
import { computeImageNodeDimensions, generateId, useAppStore } from '../../store/useAppStore';
import { downloadUrlAndSave, saveDataUrlToProjectData, buildNodeFileName } from '../../services/fileService';
import { copyFile as copyFileToClipboard } from '../../services/clipboardService';
import { useCompletionFlash } from '../../hooks/useCompletionFlash';
import {
  cancelCanvasDerivation,
  completeCanvasDerivation,
  isCanvasDerivationFresh,
  registerCanvasDerivation,
} from '../../services/canvasDerivationGuard';
import { buildVideoEditorProjectId } from '../../services/indexedDbService';
import {
  subscribeVideoEditorWindow,
  type VideoEditorExportResult,
  type VideoEditorFrameExportResult,
} from '../../services/videoEditorWindowService';

const DEFAULT_VIDEO_NODE_WIDTH = 280;
const DEFAULT_VIDEO_NODE_HEIGHT = 158;
const VIDEO_NODE_MAX_DIMENSION = 320;
const VIDEO_NODE_MIN_WIDTH = 180;
const VIDEO_NODE_MIN_HEIGHT = 110;

function computeVideoNodeDimensions(videoWidth: number, videoHeight: number): { nodeWidth: number; nodeHeight: number } {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { nodeWidth: DEFAULT_VIDEO_NODE_WIDTH, nodeHeight: DEFAULT_VIDEO_NODE_HEIGHT };
  }

  const scale = Math.max(
    VIDEO_NODE_MAX_DIMENSION / Math.max(videoWidth, videoHeight),
    VIDEO_NODE_MIN_WIDTH / videoWidth,
    VIDEO_NODE_MIN_HEIGHT / videoHeight,
  );
  return {
    nodeWidth: Math.round(videoWidth * scale),
    nodeHeight: Math.round(videoHeight * scale),
  };
}

function captureVideoFrame(video: HTMLVideoElement): { dataUrl: string; width: number; height: number } {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建截帧画布');
  }

  ctx.drawImage(video, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}

/** 节点封面只保留预览尺寸，避免把 4K 原帧常驻在组件内存。 */
function captureVideoPoster(video: HTMLVideoElement): { dataUrl: string; blank: boolean } {
  const maxDimension = 640;
  const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建视频封面画布');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let visiblePixels = 0;
  const pixelCount = Math.max(1, pixels.length / 4);
  // 跳采样即可识别尚未提交的纯黑帧，避免扫描整张高分辨率画布。
  const stride = Math.max(4, Math.floor(pixelCount / 4096) * 4);
  for (let index = 0; index < pixels.length; index += stride) {
    if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 36) visiblePixels += 1;
  }
  const sampledPixels = Math.ceil(pixels.length / stride);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    blank: visiblePixels / Math.max(1, sampledPixels) < 0.01,
  };
}

/** `seeked` 在 WebKit 中可能早于合成帧提交，必须等视频帧回调后再读取画布。 */
function afterVideoFramePresented(video: HTMLVideoElement, callback: () => void): void {
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => callback());
    return;
  }
  window.setTimeout(callback, 120);
}

/** 尾帧要略微退回，正好停在 duration 上多数解码器给不出画面 */
const LAST_FRAME_BACKOFF = 0.05;

const CAPTURE_FRAME_LABELS: Record<CaptureFramePosition, string> = {
  first: '首帧',
  current: '当前帧',
  last: '尾帧',
};

function resolveCaptureTime(video: HTMLVideoElement, position: CaptureFramePosition): number {
  if (position === 'current') return video.currentTime;
  if (position === 'first') return 0;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  return duration > 0 ? Math.max(0, duration - LAST_FRAME_BACKOFF) : video.currentTime;
}

/** 把节点里的预览视频临时定位到目标时刻取一帧，取完复位回原位置 */
function captureFrameAtTime(
  video: HTMLVideoElement,
  targetTime: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (Math.abs(video.currentTime - targetTime) < 0.01) {
    return Promise.resolve(captureVideoFrame(video));
  }

  const restoreTime = video.currentTime;
  return new Promise((resolve, reject) => {
    let timer = 0;
    const onSeeked = () => {
      // seeked 早于合成帧提交，直接读画布会拿到上一帧
      afterVideoFramePresented(video, () => {
        window.clearTimeout(timer);
        try {
          resolve(captureVideoFrame(video));
        } catch (error) {
          reject(error);
        } finally {
          video.currentTime = restoreTime;
        }
      });
    };
    timer = window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      video.currentTime = restoreTime;
      reject(new Error('视频定位超时'));
    }, 8000);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = targetTime;
  });
}

function isTaintedCanvasError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Tainted canvases') || error.message.includes('may not be exported');
}

function captureFrameFromVideoUrl(url: string, currentTime: number): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const done = () => {
      if (settled) return;
      try {
        const frame = captureVideoFrame(video);
        settled = true;
        cleanup();
        resolve(frame);
      } catch (error) {
        fail(error);
      }
    };

    timer = window.setTimeout(() => fail(new Error('本地视频加载超时')), 15000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => fail(new Error('本地视频加载失败')), { once: true });
    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const targetTime = duration > 0
        ? Math.min(Math.max(currentTime, 0), Math.max(duration - 0.01, 0))
        : 0;

      if (Math.abs(video.currentTime - targetTime) < 0.01) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          done();
        } else {
          video.addEventListener('loadeddata', done, { once: true });
        }
        return;
      }

      video.addEventListener('seeked', done, { once: true });
      video.currentTime = targetTime;
    }, { once: true });
    video.src = url;
  });
}

function AIVideoNode({ id, data, selected }: { id: string; data: BaseNodeData; selected?: boolean }) {
  const justCompleted = useCompletionFlash(data.status);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewAttemptedSourceRef = useRef<string | null>(null);
  const [generatedCover, setGeneratedCover] = useState<{ source: string; dataUrl: string } | null>(null);
  const [dismissedCoverSource, setDismissedCoverSource] = useState<string | null>(null);
  const updateNodeData = useAppStore((s) => s.updateNodeData);
  const updateNodeDataTransient = useAppStore((s) => s.updateNodeDataTransient);
  const commitToHistory = useAppStore((s) => s.commitToHistory);
  const isSingleSelection = useAppStore((s) => s.selectedNodeIds.length <= 1);
  const isSource = data.role === 'source';
  const fallbackDimensions = computeVideoNodeDimensions(data.videoWidth ?? 0, data.videoHeight ?? 0);
  const nodeWidth = data.nodeWidth ?? fallbackDimensions.nodeWidth;
  const nodeHeight = data.nodeHeight ?? fallbackDimensions.nodeHeight;

  const handleResize = useCallback(
    (newWidth: number, newHeight: number) => {
      updateNodeDataTransient(id, { nodeWidth: newWidth, nodeHeight: newHeight });
    },
    [id, updateNodeDataTransient],
  );

  const handleLoadedMetadata = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (videoWidth > 0 && videoHeight > 0) {
      const mediaDimensionsChanged = data.videoWidth !== videoWidth || data.videoHeight !== videoHeight;
      const nodeDimensionsMissing = data.nodeWidth == null || data.nodeHeight == null;
      if (mediaDimensionsChanged || nodeDimensionsMissing) {
        updateNodeDataTransient(id, {
          videoWidth,
          videoHeight,
          ...computeVideoNodeDimensions(videoWidth, videoHeight),
        });
      }
    }

    const source = data.videoUrl;
    if (!source || previewAttemptedSourceRef.current === source) return;
    previewAttemptedSourceRef.current = source;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const end = Math.max(0, duration - 0.05);
    const candidateTimes = duration > 0
      ? [...new Set([0.08, 0.25, 0.5, 0.75].map((ratio) => Math.min(end, Math.max(0.1, duration * ratio))))]
      : [0];

    const tryCandidate = (index: number) => {
      const targetTime = candidateTimes[index];
      const capturePresentedFrame = () => afterVideoFramePresented(video, () => {
        if (previewAttemptedSourceRef.current !== source) return;
        try {
          const poster = captureVideoPoster(video);
          if (poster.blank && index < candidateTimes.length - 1) {
            tryCandidate(index + 1);
            return;
          }
          if (!poster.blank) {
            setGeneratedCover({ source, dataUrl: poster.dataUrl });
            video.currentTime = 0;
          }
        } catch {
          // 远程跨域视频不能导出画布；保留已 seek 的可见帧作为降级。
        }
      });

      if (Math.abs(video.currentTime - targetTime) < 0.01
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        capturePresentedFrame();
        return;
      }
      video.addEventListener('seeked', capturePresentedFrame, { once: true });
      video.currentTime = targetTime;
    };

    tryCandidate(0);
  }, [
    data.nodeHeight,
    data.nodeWidth,
    data.videoHeight,
    data.videoUrl,
    data.videoWidth,
    id,
    updateNodeDataTransient,
  ]);

  const dismissInitialCover = useCallback(() => {
    if (data.videoUrl) setDismissedCoverSource(data.videoUrl);
  }, [data.videoUrl]);

  // ── Upload handler for source nodes ──
  const { isUploading, handleUpload: doUpload } = useSourceFileUpload('.mp4,.webm,.avi,.mov,.mkv');

  const handleUpload = useCallback(async () => {
    const result = await doUpload();
    if (!result) return;
    updateNodeData(id, {
      videoUrl: result.dataUrl,
      filePath: result.filePath,
      fileName: result.fileName,
      label: result.fileName,
      status: 'success',
    } as Partial<BaseNodeData>);
  }, [doUpload, id, updateNodeData]);

  /* ════════════════════════════════════════════
     Fullscreen State — 双击 / 工具栏按钮打开全屏预览
     ════════════════════════════════════════════ */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const handleOpenFullscreen = useCallback(() => {
    if (!data.videoUrl && !data.thumbnailUrl) return;
    setIsFullscreen(true);
  }, [data.videoUrl, data.thumbnailUrl]);
  const handleCloseFullscreen = useCallback(() => setIsFullscreen(false), []);

  const { displayLabel, handleRename } = useNodeRename(id, data, '粘贴视频');
  const generatedCoverUrl = generatedCover && generatedCover.source === data.videoUrl
    ? generatedCover.dataUrl
    : null;
  const initialCoverUrl = generatedCoverUrl || (typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null);
  const showInitialCover = !!initialCoverUrl && dismissedCoverSource !== data.videoUrl;

  // 独立编辑器窗口导出完成后，在源节点旁新建一个视频节点承载结果
  useEffect(() => {
    const projectId = useAppStore.getState().currentProjectId;
    if (!projectId) return;

    const instanceId = buildVideoEditorProjectId(projectId, id);
    return subscribeVideoEditorWindow(instanceId, (message) => {
      if (message.type === 'storyai:video-editor-frame-exported') {
        const framePayload = (message.payload ?? {}) as Partial<VideoEditorFrameExportResult>;
        const imageUrl = typeof framePayload.imageUrl === 'string' ? framePayload.imageUrl : '';
        if (!imageUrl) return;

        const frameStore = useAppStore.getState();
        const frameDerivation = registerCanvasDerivation(frameStore, id);
        if (!frameDerivation) return;

        void (async () => {
          try {
            const dims = await computeImageNodeDimensions(imageUrl);
            // 取帧要等图片解码，期间可能已切项目或删节点，落盘前再验一次
            if (!isCanvasDerivationFresh(frameDerivation, useAppStore.getState())) {
              cancelCanvasDerivation(frameDerivation);
              return;
            }

            const liveStore = useAppStore.getState();
            const frameSource = liveStore.nodes.find((node) => node.id === id);
            const framePosition = frameSource?.position ?? { x: 0, y: 0 };
            const time = typeof framePayload.time === 'number' ? framePayload.time : 0;

            liveStore.addNode({
              id: `node-${generateId()}`,
              type: 'ai-image',
              // 放在剪辑结果节点下方，避免和"导出为新节点"的产物叠在一起
              position: {
                x: framePosition.x + nodeWidth + 40,
                y: framePosition.y + nodeHeight + 40,
              },
              data: {
                label: `${displayLabel} ${time.toFixed(2)}s 帧`,
                type: 'ai-image',
                role: 'source',
                status: 'success',
                imageUrl,
                filePath: typeof framePayload.filePath === 'string' ? framePayload.filePath : undefined,
                fileName: typeof framePayload.fileName === 'string' ? framePayload.fileName : undefined,
                imageWidth: typeof framePayload.width === 'number' ? framePayload.width : undefined,
                imageHeight: typeof framePayload.height === 'number' ? framePayload.height : undefined,
                ...dims,
              },
            } as Parameters<typeof liveStore.addNode>[0]);

            completeCanvasDerivation(frameDerivation);
            useAppStore.getState().showToast('当前帧已生成图片节点');
          } catch (error) {
            cancelCanvasDerivation(frameDerivation);
            console.error('[videoEditor] 当前帧回写失败:', error);
            useAppStore.getState().showToast('当前帧生成节点失败', 'error');
          }
        })();
        return;
      }

      if (message.type !== 'storyai:video-editor-exported') return;
      const payload = (message.payload ?? {}) as Partial<VideoEditorExportResult>;
      const videoUrl = typeof payload.videoUrl === 'string' ? payload.videoUrl : '';
      if (!videoUrl) return;

      // 导出是跨窗口的异步结果：期间可能已切换项目或删掉源节点，
      // 用派生守卫挡掉过期回写，避免落到别的画布上
      const store = useAppStore.getState();
      const derivation = registerCanvasDerivation(store, id);
      if (!derivation) return;
      if (!isCanvasDerivationFresh(derivation, useAppStore.getState())) {
        cancelCanvasDerivation(derivation);
        return;
      }

      const sourceNode = store.nodes.find((node) => node.id === id);
      const position = sourceNode?.position ?? { x: 0, y: 0 };
      const outputWidth = typeof payload.width === 'number' ? payload.width : 0;
      const outputHeight = typeof payload.height === 'number' ? payload.height : 0;
      const dimensions = computeVideoNodeDimensions(outputWidth, outputHeight);

      store.addNode({
        id: `node-${generateId()}`,
        type: 'ai-video',
        position: { x: position.x + nodeWidth + 40, y: position.y },
        data: {
          label: `${displayLabel} 剪辑`,
          type: 'ai-video',
          role: 'source',
          status: 'success',
          videoUrl,
          filePath: typeof payload.filePath === 'string' ? payload.filePath : undefined,
          fileName: typeof payload.fileName === 'string' ? payload.fileName : undefined,
          videoDuration: typeof payload.duration === 'number' ? payload.duration : undefined,
          videoWidth: outputWidth || undefined,
          videoHeight: outputHeight || undefined,
          ...dimensions,
        },
      } as Parameters<typeof store.addNode>[0]);

      completeCanvasDerivation(derivation);
      useAppStore.getState().showToast('剪辑结果已生成新节点');
    });
  }, [displayLabel, id, nodeHeight, nodeWidth]);

  const handleCopyFile = useCallback(async () => {
    const store = useAppStore.getState();
    const filePath = data.filePath as string | undefined;
    if (!filePath) {
      store.showToast('该视频没有本地文件，无法复制', 'error');
      return;
    }
    const ok = await copyFileToClipboard(filePath);
    store.showToast(ok ? '已复制视频到剪贴板' : '复制失败', ok ? undefined : 'error');
  }, [data.filePath]);

  const handleCaptureFrame = useCallback(async (position: CaptureFramePosition = 'current') => {
    const store = useAppStore.getState();
    const video = videoRef.current;
    const frameLabel = CAPTURE_FRAME_LABELS[position];

    if (!video || !data.videoUrl) {
      store.showToast('没有可截取的视频', 'error');
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      store.showToast('视频尚未加载到可截取的帧', 'error');
      return;
    }

    const derivation = registerCanvasDerivation(store, id);
    if (!derivation) {
      store.showToast('视频节点已失效，请重试', 'error');
      return;
    }
    const captureTime = resolveCaptureTime(video, position);
    const ensureFresh = () => {
      const fresh = isCanvasDerivationFresh(derivation, useAppStore.getState());
      if (!fresh) cancelCanvasDerivation(derivation);
      return fresh;
    };

    const createFrameNode = async (frame: { dataUrl: string; width: number; height: number }): Promise<boolean> => {
      const dims = await computeImageNodeDimensions(frame.dataUrl);
      if (!ensureFresh()) return false;

      let liveStore = useAppStore.getState();
      const currentNode = liveStore.nodes.find((node) => node.id === id);
      const currentPosition = currentNode?.position ?? { x: 0, y: 0 };
      const frameFileName = buildNodeFileName(`${displayLabel} ${frameLabel}`, 'png', `video-frame-${Date.now()}`);
      const savedFrame = derivation.projectId !== 'default'
        ? await saveDataUrlToProjectData(frame.dataUrl, derivation.projectId, frameFileName)
        : null;
      if (!ensureFresh()) return false;

      liveStore = useAppStore.getState();
      const imageUrl = savedFrame?.assetUrl || frame.dataUrl;

      liveStore.addNode({
        id: `node-${generateId()}`,
        type: 'ai-image',
        position: {
          x: currentPosition.x + nodeWidth + 40,
          y: currentPosition.y,
        },
        data: {
          label: `${displayLabel} ${frameLabel}`,
          type: 'ai-image',
          role: 'source',
          status: 'success',
          imageUrl,
          filePath: savedFrame?.filePath,
          fileName: frameFileName,
          imageWidth: frame.width,
          imageHeight: frame.height,
          ...dims,
        },
      } as Parameters<typeof liveStore.addNode>[0]);
      completeCanvasDerivation(derivation);
      return true;
    };

    try {
      const created = await createFrameNode(await captureFrameAtTime(video, captureTime));
      if (created) useAppStore.getState().showToast(`已截取${frameLabel}为图像节点`, 'success');
    } catch (error) {
      if (!isTaintedCanvasError(error)) {
        cancelCanvasDerivation(derivation);
        const message = error instanceof Error ? error.message : `截取${frameLabel}失败`;
        if (useAppStore.getState().currentProjectId === derivation.projectId) {
          useAppStore.getState().showToast(`截取${frameLabel}失败：${message}`, 'error');
        }
        return;
      }

      const remoteUrl = typeof data.sourceUrl === 'string' ? data.sourceUrl : data.videoUrl;
      if (!remoteUrl?.startsWith('http') || derivation.projectId === 'default') {
        cancelCanvasDerivation(derivation);
        useAppStore.getState().showToast(`该视频来源禁止导出${frameLabel}，请先上传为本地视频后再截帧`, 'error');
        return;
      }
      if (!ensureFresh()) return;

      useAppStore.getState().showToast('远程视频受跨域限制，正在转为本地资源后重试...', 'success');
      const saved = await downloadUrlAndSave(remoteUrl, derivation.projectId, 'video-source');
      if (!ensureFresh()) return;
      if (!saved?.assetUrl) {
        cancelCanvasDerivation(derivation);
        useAppStore.getState().showToast(`远程视频本地化失败，无法截取${frameLabel}`, 'error');
        return;
      }

      try {
        useAppStore.getState().updateNodeData(id, {
          videoUrl: saved.assetUrl,
          filePath: saved.filePath,
          sourceUrl: remoteUrl,
        } as Partial<BaseNodeData>);

        const created = await createFrameNode(await captureFrameFromVideoUrl(saved.assetUrl, captureTime));
        if (created) useAppStore.getState().showToast(`已截取${frameLabel}为图像节点`, 'success');
      } catch (fallbackError) {
        cancelCanvasDerivation(derivation);
        const message = fallbackError instanceof Error ? fallbackError.message : '本地资源截帧失败';
        if (useAppStore.getState().currentProjectId === derivation.projectId) {
          useAppStore.getState().showToast(`截取${frameLabel}失败：${message}`, 'error');
        }
      }
    }
  }, [data.sourceUrl, data.videoUrl, displayLabel, id, nodeWidth]);

  return (
    <div className="node-wrapper relative" style={{ width: nodeWidth }}>
      <NodeLabel
        kind="ai-video"
        label={displayLabel}
        displayId={data.displayId as number | undefined}
        nodeId={id}
        onRename={handleRename}
      />
      {data.videoUrl && (
        <div className={`node-toolbar-shell ${selected && isSingleSelection ? 'is-visible' : ''}`}>
          <VideoNodeToolbar nodeId={id} onCaptureFrame={handleCaptureFrame} onFullscreen={handleOpenFullscreen} onCopyFile={handleCopyFile} />
        </div>
      )}
      <div
        className={`node video-node ${selected ? 'selected' : ''} ${data.status === 'loading' || isUploading ? 'loading' : ''} ${justCompleted ? 'just-completed' : ''}`}
        style={{ height: nodeHeight }}
      >
        <div className={`node-preview compact${data.videoUrl || data.thumbnailUrl ? ' has-media' : ''}`}>
          {data.videoUrl ? (
            <video
              ref={videoRef}
              src={data.videoUrl}
              className="video-preview-player compact"
              crossOrigin="anonymous"
              playsInline
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={dismissInitialCover}
              onDoubleClick={(e) => { e.stopPropagation(); handleOpenFullscreen(); }}
              data-source-url={data.sourceUrl}
            />
          ) : data.thumbnailUrl ? (
            <img
              src={data.thumbnailUrl}
              alt="Video thumbnail"
              className="video-node-poster"
              onDoubleClick={(e) => { e.stopPropagation(); handleOpenFullscreen(); }}
            />
          ) : isUploading ? (
            <div className="node-preview-loading">
              <div className="spinner large" />
              <span>上传中...</span>
            </div>
          ) : data.status === 'loading' ? (
            <div className="node-preview-loading">
              <div className="spinner large" />
              <span>生成视频中...</span>
            </div>
          ) : (
            isSource ? (
              <button
                type="button"
                className="node-preview-placeholder nodrag nopan border-0 bg-transparent p-0 cursor-pointer transition-[color,transform] duration-100 hover:text-canvas-text-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-canvas-border"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleUpload();
                }}
                data-tooltip="上传视频"
                aria-label="上传视频"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </button>
            ) : (
              <div className="node-preview-placeholder">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              </div>
            )
          )}
          {data.videoUrl && showInitialCover && (
            <img src={initialCoverUrl} alt="" className="video-node-initial-cover" draggable={false} />
          )}
          {data.videoUrl && (
            <VideoNodeControls
              videoRef={videoRef}
              source={data.videoUrl}
              onInteract={dismissInitialCover}
            />
          )}
        </div>
        {data.error && <NodeError nodeId={id} message={data.error} />}
        <Handle type="source" position={Position.Left} id="left" className="node-handle handle-source handle-video" >
          <GooeyBtn className="gooey-btn-left" hue={217} />
        </Handle>
        <Handle type="source" position={Position.Right} id="right" className="node-handle handle-source handle-video" >
          <GooeyBtn className="gooey-btn-right" hue={217} />
        </Handle>
      </div>

      <ResizeHandle
        nodeId={id}
        currentWidth={nodeWidth}
        currentHeight={nodeHeight}
        minWidth={VIDEO_NODE_MIN_WIDTH}
        minHeight={VIDEO_NODE_MIN_HEIGHT}
        lockAspectRatio
        onResizeStart={commitToHistory}
        onResizeEnd={commitToHistory}
        onResize={handleResize}
      />

      {/* 全屏预览 */}
      <FullscreenOverlay
        isOpen={isFullscreen}
        onClose={handleCloseFullscreen}
        hidePanel
        title={(data.label as string) || '视频预览'}
      >
        {data.videoUrl ? (
          <video
            ref={fullscreenVideoRef}
            src={data.videoUrl}
            className="fullscreen-video-view"
            controls
            autoPlay
            crossOrigin="anonymous"
            data-source-url={data.sourceUrl}
          />
        ) : data.thumbnailUrl ? (
          <img
            src={data.thumbnailUrl}
            alt="Video thumbnail"
            className="fullscreen-img-view"
          />
        ) : null}
      </FullscreenOverlay>
    </div>
  );
}

export default memo(AIVideoNode);

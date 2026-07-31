/**
 * VideoEditorWindow — 独立「视频编辑器」窗口（由视频节点右键「编辑视频」唤起）
 *
 * 与资源搜索窗口同构：不依赖主窗口 zustand store，直接复用 fileService /
 * IndexedDB（同源共享），自行应用 data-theme 并自绘标题栏。
 *
 * 时间轴支持多片段（多选打开、分割），导出走关键帧对齐的无损直通。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  loadConfig,
  loadProjectsList,
  registerProjectFolders,
  setBaseDataDir,
  syncAuthorizedDirectories,
  saveBinaryToProjectData,
  buildNodeFileName,
} from '../../services/fileService';
import {
  buildVideoEditorProjectId,
  getVideoEditorProject,
  saveVideoEditorProject,
} from '../../services/indexedDbService';
import {
  createVideoInput,
  exportComposite,
  exportLosslessConcat,
  VideoExportCanceledError,
  type ConcatSegment,
} from '../../services/videoEditorMediaService';
import {
  createClipRenderSource,
  type ClipRenderSource,
} from '../../services/videoCompositor';
import type { Input } from 'mediabunny';
import {
  postVideoEditorExported,
  postVideoEditorReady,
} from '../../services/videoEditorWindowService';
import {
  computeTimelineDuration,
  DEFAULT_TRANSFORM,
  findClipAtTime,
  getVideoTrack,
  hasMixedSources,
  needsCompositing,
  relayoutSequential,
  splitClipsAt,
  type VideoEditorCanvasSize,
  type VideoEditorClip,
  type VideoEditorProjectRecord,
  type VideoEditorTrack,
} from '../../types/videoEditor';
import type { AppConfig } from '../../types';
import VideoEditorTimeline from './VideoEditorTimeline';
import VideoEditorPreview from './VideoEditorPreview';
import VideoEditorMediaPanel from './VideoEditorMediaPanel';
import VideoEditorInspector from './VideoEditorInspector';
import { resolveClipUrl, useVideoEditorSources } from './useVideoEditorSources';
import { useTimelineHistory } from './useTimelineHistory';
import {
  createTrack,
  duplicateClip,
  moveClipTo,
  moveTrack,
  removeClips,
  removeTrack,
} from './timelineOps';

type EditorPhase = 'loading' | 'ready' | 'error';

/** 独立窗口开不了 devtools，错误详情必须能在界面上直接看到并复制 */
interface EditorFailure {
  stage: string;
  message: string;
  detail: string;
}

function describeFailure(stage: string, reason: unknown): EditorFailure {
  if (reason instanceof Error) {
    return {
      stage,
      // WebKit 的 fetch 失败只会给出 "Type error"，必须带上 name 才能分辨
      message: `${reason.name}: ${reason.message}`,
      detail: reason.stack || `${reason.name}: ${reason.message}`,
    };
  }
  return { stage, message: String(reason), detail: String(reason) };
}

/** 给某个阶段的异步操作打上标签，失败时能立刻知道断在哪一步 */
async function withStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (reason) {
    if (reason instanceof VideoExportCanceledError) throw reason;
    const failure = describeFailure(stage, reason);
    const error = new Error(`${stage}：${failure.message}`);
    error.stack = failure.detail;
    throw error;
  }
}

/** 把失败详情摊在界面上并支持一键复制——这个窗口开不了 devtools */
function FailureReport({ failure, fallback }: { failure: EditorFailure | null; fallback: string }) {
  if (!failure) return <span>{fallback}</span>;

  const full = `[${failure.stage}] ${failure.message}\n${failure.detail}`;
  return (
    <div className="video-editor-failure">
      <div className="video-editor-failure-line">
        <strong>{failure.stage}失败：</strong>{failure.message}
        <button
          type="button"
          className="video-editor-failure-copy"
          onClick={() => { void navigator.clipboard?.writeText(full).catch(() => {}); }}
        >
          复制详情
        </button>
      </div>
      {failure.detail && failure.detail !== failure.message && (
        <details className="video-editor-failure-detail">
          <summary>调用栈</summary>
          <pre>{failure.detail}</pre>
        </details>
      )}
    </div>
  );
}

interface SessionParams {
  instanceId: string;
  projectId: string;
  nodeId: string;
  theme: 'dark' | 'light';
}

function readSessionParams(): SessionParams | null {
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get('instanceId')?.trim();
  const projectId = params.get('projectId')?.trim();
  const nodeId = params.get('nodeId')?.trim();
  if (!instanceId || !projectId || !nodeId) return null;
  return {
    instanceId,
    projectId,
    nodeId,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
  };
}

export default function VideoEditorWindow() {
  const session = useMemo(() => readSessionParams(), []);

  // 会话参数缺失是渲染前就能判定的，直接作为初始状态，不必绕一圈 effect
  const [phase, setPhase] = useState<EditorPhase>(session ? 'loading' : 'error');
  const [failure, setFailure] = useState<EditorFailure | null>(
    session ? null : { stage: '启动', message: '缺少必要的会话参数，无法打开编辑器', detail: '' },
  );
  const [record, setRecord] = useState<VideoEditorProjectRecord | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<string | null>(null);
  const [exportFrameRate, setExportFrameRate] = useState(30);
  // 输出分辨率相对源尺寸的倍率；4K 编码不通时可降到 1080p/720p
  const [outputScale, setOutputScale] = useState(1);
  const exportAbortRef = useRef<AbortController | null>(null);

  const tracks = useMemo(() => record?.tracks ?? [], [record]);
  const videoTrack = getVideoTrack(tracks);
  const clips = useMemo(() => videoTrack?.clips ?? [], [videoTrack]);

  const persistTracks = useCallback((nextTracks: VideoEditorTrack[]) => {
    setRecord((previous) => {
      if (!previous) return previous;
      const next = { ...previous, tracks: nextTracks, updatedAt: Date.now() };
      void saveVideoEditorProject(next).catch((reason) => {
        console.error('[videoEditor] 工程保存失败:', reason);
      });
      return next;
    });
  }, []);

  const updateVideoClips = useCallback((
    mutate: (clips: VideoEditorTrack['clips']) => VideoEditorTrack['clips'],
  ) => {
    setRecord((previous) => {
      if (!previous) return previous;
      const nextTracks = previous.tracks.map((track) => (
        track.kind === 'video' ? { ...track, clips: relayoutSequential(mutate(track.clips)) } : track
      ));
      const next = { ...previous, tracks: nextTracks, updatedAt: Date.now() };
      void saveVideoEditorProject(next).catch((reason) => {
        console.error('[videoEditor] 工程保存失败:', reason);
      });
      return next;
    });
  }, []);

  // 节点上没带 videoDuration 的片段出点初始为 0，探测到真实时长后回填
  const handleSourceProbed = useCallback((url: string, probe: { duration: number }) => {
    if (probe.duration <= 0) return;
    updateVideoClips((current) => current.map((clip) => (
      clip.sourceOut <= 0 && resolveClipUrl(clip) === url
        ? { ...clip, sourceOut: probe.duration }
        : clip
    )));
  }, [updateVideoClips]);

  const { getSource } = useVideoEditorSources(clips, handleSourceProbed);

  const timelineDuration = computeTimelineDuration(tracks);
  const activeClip = findClipAtTime(clips, playhead)?.clip ?? clips[0] ?? null;
  const activeClipUrl = activeClip ? resolveClipUrl(activeClip) : '';
  const selectedClip = clips.find((clip) => clip.id === selectedClipIds[0]) ?? null;
  const activeProbe = activeClip ? (getSource(activeClip)?.probe ?? null) : null;

  // 合成画布尺寸取主轨首个可解码片段的分辨率，退回 1080p。
  // 计算极轻，直接派生即可，不值得为它维护一份 memo 依赖
  const firstSized = clips
    .map((clip) => getSource(clip)?.probe)
    .find((probe) => probe && probe.width > 0 && probe.height > 0);
  const canvasWidth = firstSized?.width || 1920;
  const canvasHeight = firstSized?.height || 1080;
  const canvasSize: VideoEditorCanvasSize = useMemo(
    () => (outputScale === 1
      ? { width: canvasWidth, height: canvasHeight }
      // 编码器对尺寸有偶数要求，缩放后向下取偶
      : {
        width: Math.max(2, Math.round((canvasWidth * outputScale) / 2) * 2),
        height: Math.max(2, Math.round((canvasHeight * outputScale) / 2) * 2),
      }),
    [canvasHeight, canvasWidth, outputScale],
  );

  // 素材编码/分辨率不一致时无法直通拼接，必须走合成归一到同一张画布
  const mixedSources = hasMixedSources(clips.map((clip) => {
    const probe = getSource(clip)?.probe;
    return probe && { codec: probe.videoCodec, width: probe.width, height: probe.height };
  }));
  const compositing = needsCompositing(tracks) || mixedSources;

  // ── 载入：配置 → 工程 ──
  useEffect(() => {
    if (!session) return;

    let active = true;
    void (async () => {
      try {
        const config = (await loadConfig()) as AppConfig | null;
        document.documentElement.setAttribute(
          'data-theme',
          config?.theme === 'light' ? 'light' : session.theme,
        );
        setBaseDataDir(config?.baseDataDir);
        await syncAuthorizedDirectories(config ?? {});
        // 独立窗口有自己的模块实例：不注册项目文件夹名，
        // resolveProjectFolder 会退化成用 projectId 当目录名，导出就会落错目录
        const projects = await loadProjectsList();
        registerProjectFolders(projects as { id: string; dataFolder?: string }[]);
        if (!active) return;

        // 工程由主窗口在开窗前写入共享库，这里只按 ID 取回
        const projectRecordId = buildVideoEditorProjectId(session.projectId, session.nodeId);
        const loaded = await getVideoEditorProject(projectRecordId);
        if (!loaded) throw new Error('未找到该节点的剪辑工程');
        if (!active) return;

        setRecord(loaded);
        setPhase('ready');
        void postVideoEditorReady(session.instanceId).catch(() => {});
      } catch (reason) {
        if (!active) return;
        setFailure(describeFailure('载入', reason));
        setPhase('error');
        console.error('[videoEditor] 载入失败:', reason);
      }
    })();

    return () => { active = false; };
  }, [session]);

  // ── 撤销重做：改动前落一个轨道快照 ──
  const history = useTimelineHistory();
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const beginInteraction = useCallback(() => {
    history.commit(tracksRef.current);
  }, [history]);

  const handleUndo = useCallback(() => {
    const restored = history.undo(tracksRef.current);
    if (restored) persistTracks(restored);
  }, [history, persistTracks]);

  const handleRedo = useCallback(() => {
    const restored = history.redo(tracksRef.current);
    if (restored) persistTracks(restored);
  }, [history, persistTracks]);

  // 连续拖拽只在按下时记一次快照，避免历史被中间态灌满
  const trimSessionRef = useRef<string | null>(null);
  const handleTrimClip = useCallback((clipId: string, sourceIn: number, sourceOut: number) => {
    if (trimSessionRef.current !== clipId) trimSessionRef.current = clipId;
    updateVideoClips((current) => current.map((clip) => (
      clip.id === clipId ? { ...clip, sourceIn, sourceOut } : clip
    )));
  }, [updateVideoClips]);

  const handleSplit = useCallback(() => {
    if (!videoTrack) return;
    const split = splitClipsAt(videoTrack.clips, playhead);
    if (!split) {
      setNotice('当前播放头不在可分割的位置');
      return;
    }
    setNotice(null);
    beginInteraction();
    updateVideoClips(() => split);
  }, [beginInteraction, playhead, updateVideoClips, videoTrack]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    if (clips.length <= selectedClipIds.length) {
      setNotice('至少要保留一个片段');
      return;
    }
    beginInteraction();
    updateVideoClips((current) => removeClips(current, selectedClipIds));
    setSelectedClipIds([]);
  }, [beginInteraction, clips.length, selectedClipIds, updateVideoClips]);

  const handleDuplicateClip = useCallback((clipId: string) => {
    beginInteraction();
    updateVideoClips((current) => duplicateClip(current, clipId));
  }, [beginInteraction, updateVideoClips]);

  /** 改选中片段的某个属性；这些改动都会让导出切到合成路径 */
  const patchSelectedClip = useCallback((patch: (clip: VideoEditorClip) => VideoEditorClip) => {
    const targetId = selectedClipIds[0] ?? activeClip?.id;
    if (!targetId) return;
    beginInteraction();
    setRecord((previous) => {
      if (!previous) return previous;
      const nextTracks = previous.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === targetId ? patch(clip) : clip)),
      }));
      const next = { ...previous, tracks: nextTracks, updatedAt: Date.now() };
      void saveVideoEditorProject(next).catch((reason) => {
        console.error('[videoEditor] 工程保存失败:', reason);
      });
      return next;
    });
  }, [activeClip?.id, beginInteraction, selectedClipIds]);

  const handleAddTrack = useCallback((kind: 'video' | 'audio') => {
    beginInteraction();
    persistTracks([...tracksRef.current, createTrack(kind, tracksRef.current)]);
  }, [beginInteraction, persistTracks]);

  const handleRemoveTrack = useCallback((trackId: string) => {
    beginInteraction();
    persistTracks(removeTrack(tracksRef.current, trackId));
  }, [beginInteraction, persistTracks]);

  const handleMoveTrack = useCallback((trackId: string, direction: -1 | 1) => {
    beginInteraction();
    persistTracks(moveTrack(tracksRef.current, trackId, direction));
  }, [beginInteraction, persistTracks]);

  const handleMoveClip = useCallback((clipId: string, targetIndex: number) => {
    updateVideoClips((current) => moveClipTo(current, clipId, targetIndex));
  }, [updateVideoClips]);

  const canSplit = !!videoTrack && !!findClipAtTime(clips, playhead);

  // 快捷键：空格播放、S 分割、Del 删除、Ctrl+D 复制、Ctrl+Z/Y 撤销重做、←→ 逐帧
  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if (modifier && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (modifier && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        if (selectedClipIds[0]) handleDuplicateClip(selectedClipIds[0]);
        return;
      }
      if (modifier && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        setSelectedClipIds(clips.map((clip) => clip.id));
        return;
      }
      if (modifier) return;

      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        handleSplit();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        handleDeleteSelected();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlayhead((current) => Math.max(0, current - (event.shiftKey ? 1 : 1 / 30)));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlayhead((current) => Math.min(timelineDuration, current + (event.shiftKey ? 1 : 1 / 30)));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPlayhead(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setPlayhead(timelineDuration);
      } else if (event.key === 'Escape') {
        setSelectedClipIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    clips, handleDeleteSelected, handleDuplicateClip, handleRedo, handleSplit,
    handleUndo, phase, selectedClipIds, timelineDuration,
  ]);

  const handleExport = useCallback(async () => {
    if (!session || !record) return;
    const allClips = tracks.flatMap((track) => (track.hidden ? [] : track.clips));
    if (allClips.length === 0) return;

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting(true);
    setExportProgress(0);
    setFailure(null);
    setNotice(null);
    setExportStage(null);

    const opened: Input[] = [];
    try {
      // 打开每个片段的素材；同一素材只开一次
      const inputsByUrl = new Map<string, Input>();
      await withStage('打开素材', async () => {
        for (const clip of allClips) {
          const url = resolveClipUrl(clip);
          if (!url || inputsByUrl.has(url)) continue;
          const input = await createVideoInput(url);
          inputsByUrl.set(url, input);
          opened.push(input);
        }
      });
      const inputFor = (clip: VideoEditorClip) => inputsByUrl.get(resolveClipUrl(clip));

      let bytes: Uint8Array;
      const notes: string[] = [];

      let audioNote: string | null = null;

      /** 逐帧渲染 + 重编码；直通做不到时也走这里 */
      const runComposite = async () => {
        // 合成路径：逐帧渲染 + 重编码，支持叠加、画中画、转场与混音
        const renderSources = new Map<string, ClipRenderSource>();
        await withStage('准备合成', async () => {
          for (const [url, input] of inputsByUrl) {
            const source = await createClipRenderSource(input);
            if (source) renderSources.set(url, source);
          }
          // 图片片段用位图直接绘制
          for (const clip of allClips) {
            if (clip.kind !== 'image') continue;
            const url = resolveClipUrl(clip);
            if (!url || renderSources.has(url)) continue;
            const response = await fetch(url);
            const bitmap = await createImageBitmap(await response.blob());
            renderSources.set(url, {
              bitmap,
              width: bitmap.width,
              height: bitmap.height,
            });
          }
        });

        return withStage('合成导出', () => exportComposite({
          tracks,
          duration: timelineDuration,
          canvas: canvasSize,
          frameRate: exportFrameRate,
          resolveVideo: (clip) => renderSources.get(resolveClipUrl(clip)),
          resolveAudio: inputFor,
          onProgress: setExportProgress,
          onStage: setExportStage,
          onAudioMode: (mode, reason) => {
            audioNote = mode === 'encode'
              ? '音频已重新混流'
              : mode === 'copy'
                ? '音频以原始分组直通保留（本机无 AudioEncoder，故未做混流）'
                : `未输出音轨：${reason ?? '无可用音频'}`;
          },
          signal: controller.signal,
        }));
      };

      if (compositing) {
        bytes = await runComposite();
        notes.push(`已合成导出 ${allClips.length} 个片段 · ${canvasSize.width}×${canvasSize.height} · ${exportFrameRate}fps`);
        if (mixedSources) notes.push('素材分辨率或编码不一致，已归一到同一画布');
        notes.push('画面经过一次重编码');
        if (audioNote) notes.push(audioNote);
      } else {
        // 简单时间轴走无损直通，避免无谓的画质损失
        const segments: ConcatSegment[] = clips.map((clip) => ({
          input: inputFor(clip)!,
          start: clip.sourceIn,
          end: clip.sourceOut,
          label: clip.fileName,
        }));
        try {
          const result = await withStage('无损裁剪导出', () => exportLosslessConcat({
            segments,
            onProgress: setExportProgress,
            signal: controller.signal,
          }));
          bytes = result.bytes;

          const drift = clips[0].sourceIn - result.actualStart;
          notes.push(`已无损导出 ${clips.length} 个片段，共 ${timelineDuration.toFixed(2)}s`);
          if (drift > 0.05) {
            notes.push(`首段按关键帧对齐，实际入点 ${result.actualStart.toFixed(2)}s（比设定早 ${drift.toFixed(2)}s）`);
          }
          if (clips.length > 1) notes.push('多片段无损拼接不保留音轨；需要音轨请启用任一合成能力');
        } catch (reason) {
          if (reason instanceof VideoExportCanceledError) throw reason;
          // 直通做不到（例如素材参数不一致）不该把死路甩给用户，自动改走合成
          console.warn('[videoEditor] 无损直通不可用，改走合成:', reason);
          setExportProgress(0);
          bytes = await runComposite();
          notes.push(`无损直通不可用，已改用合成导出 · ${canvasSize.width}×${canvasSize.height} · ${exportFrameRate}fps`);
          if (audioNote) notes.push(audioNote);
          notes.push(reason instanceof Error ? reason.message : String(reason));
        }
      }

      const fileName = buildNodeFileName(record.name, 'mp4', 'edited');
      const saved = await withStage('写入项目目录', async () => {
        const result = await saveBinaryToProjectData(bytes, record.projectId, fileName);
        if (!result) throw new Error('项目数据目录不可写');
        return result;
      });

      await withStage('输出到画布', () => postVideoEditorExported(session.instanceId, {
        videoUrl: saved.assetUrl,
        filePath: saved.filePath,
        fileName,
        duration: timelineDuration,
        // 合成路径按画布尺寸出片，直通路径保持源尺寸
        width: compositing ? canvasSize.width : (firstSized?.width ?? 0),
        height: compositing ? canvasSize.height : (firstSized?.height ?? 0),
      }));

      setNotice(notes.join('；'));
    } catch (reason) {
      if (!(reason instanceof VideoExportCanceledError)) {
        setFailure(describeFailure('导出', reason));
        console.error('[videoEditor] 导出失败:', reason);
      }
    } finally {
      opened.forEach((input) => input.dispose());
      exportAbortRef.current = null;
      setExporting(false);
      setExportProgress(0);
      setExportStage(null);
    }
  }, [
    canvasSize, clips, compositing, exportFrameRate, firstSized?.height, firstSized?.width,
    mixedSources, record, session, timelineDuration, tracks,
  ]);

  const closeWindow = useCallback(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }, []);

  const minimizeWindow = useCallback(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }, []);

  return (
    <div className="video-editor-root">
      <header className="video-editor-header" data-tauri-drag-region>
        <h1 className="video-editor-title">{record?.name || '视频编辑器'}</h1>
        {activeProbe && (
          <span className="video-editor-meta">
            {activeProbe.width}×{activeProbe.height} · {clips.length} 个片段 ·{' '}
            {timelineDuration.toFixed(2)}s
          </span>
        )}
        <div className="video-editor-winctrls">
          {exporting ? (
            <>
              <span className="video-editor-progress">
                {exportStage ?? '导出中'} {Math.round(exportProgress * 100)}%
              </span>
              <button
                type="button"
                className="video-editor-btn"
                onClick={() => exportAbortRef.current?.abort()}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="video-editor-btn primary"
              onClick={() => { void handleExport(); }}
              disabled={phase !== 'ready' || clips.length === 0}
            >
              <Icon icon="lucide:upload" width={13} height={13} />
              导出为新节点
            </button>
          )}
          <button
            type="button"
            className="video-editor-winbtn"
            onClick={() => { void minimizeWindow(); }}
            aria-label="最小化"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="video-editor-winbtn close"
            onClick={() => { void closeWindow(); }}
            aria-label="关闭"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </header>

      {phase === 'error' && (
        <div className="video-editor-error">
          <FailureReport failure={failure} fallback="编辑器加载失败" />
        </div>
      )}

      {phase === 'loading' && <div className="video-editor-loading">正在载入素材…</div>}

      {phase === 'ready' && record && (
        <>
          {failure && (
            <div className="video-editor-error inline">
              <FailureReport failure={failure} fallback="导出失败" />
            </div>
          )}
          {notice && <div className="video-editor-notice">{notice}</div>}
          <div className="video-editor-body">
            <VideoEditorMediaPanel
              clips={clips}
              getSource={getSource}
              selectedClipId={selectedClipIds[0] ?? null}
              onSelectClip={(clipId) => setSelectedClipIds([clipId])}
            />
            <VideoEditorPreview
              clip={activeClip}
              clipUrl={activeClipUrl}
              playhead={playhead}
              timelineDuration={timelineDuration}
              onPlayheadChange={setPlayhead}
            />
            <VideoEditorInspector
              clip={selectedClip ?? activeClip}
              probe={activeProbe}
              clipCount={clips.length}
              timelineDuration={timelineDuration}
              canvasSize={canvasSize}
              compositing={compositing}
              mixedSources={mixedSources}
              frameRate={exportFrameRate}
              onFrameRateChange={setExportFrameRate}
              outputScale={outputScale}
              onOutputScaleChange={setOutputScale}
              onTransformChange={(patch) => patchSelectedClip((clip) => ({
                ...clip,
                transform: { ...DEFAULT_TRANSFORM, ...clip.transform, ...patch },
              }))}
              onTransitionChange={(kind, duration) => patchSelectedClip((clip) => ({
                ...clip,
                transitionIn: { kind, duration },
              }))}
              onVolumeChange={(volume) => patchSelectedClip((clip) => ({ ...clip, volume }))}
            />
          </div>
          <VideoEditorTimeline
            tracks={tracks}
            duration={timelineDuration}
            playhead={playhead}
            selectedClipIds={selectedClipIds}
            getSource={getSource}
            snapEnabled={snapEnabled}
            onToggleSnap={() => setSnapEnabled((value) => !value)}
            onPlayheadChange={setPlayhead}
            onSelectClips={setSelectedClipIds}
            onTrimClip={handleTrimClip}
            onMoveClip={handleMoveClip}
            onSplit={handleSplit}
            onDeleteSelected={handleDeleteSelected}
            onDuplicateClip={handleDuplicateClip}
            onTracksChange={persistTracks}
            onAddTrack={handleAddTrack}
            onRemoveTrack={handleRemoveTrack}
            onMoveTrack={handleMoveTrack}
            onBeginInteraction={beginInteraction}
            canSplit={canSplit}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
        </>
      )}
    </div>
  );
}

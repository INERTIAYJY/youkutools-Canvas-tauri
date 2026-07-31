/**
 * 时间轴撤销重做 —— 对轨道数组做快照。
 *
 * 剪辑工程体量小（片段是元数据，不含媒体），整份快照比记录反向操作简单可靠；
 * 连续拖拽这类高频改动由调用方决定何时落一个快照。
 */
import { useCallback, useRef, useState } from 'react';
import type { VideoEditorTrack } from '../../types/videoEditor';

/** 快照上限，防止长时间编辑把内存吃掉 */
const MAX_HISTORY = 50;

export interface TimelineHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** 在改动发生「之前」记录当前状态 */
  commit: (current: VideoEditorTrack[]) => void;
  /** 开始连续交互；重复调用不会追加快照 */
  begin: (current: VideoEditorTrack[]) => void;
  /** 结束连续交互 */
  end: () => void;
  undo: (current: VideoEditorTrack[]) => VideoEditorTrack[] | null;
  redo: (current: VideoEditorTrack[]) => VideoEditorTrack[] | null;
  reset: () => void;
}

export function useTimelineHistory(): TimelineHistory {
  const [past, setPast] = useState<VideoEditorTrack[][]>([]);
  const [future, setFuture] = useState<VideoEditorTrack[][]>([]);
  const interactionActiveRef = useRef(false);

  const recordSnapshot = useCallback((current: VideoEditorTrack[]) => {
    setPast((entries) => [...entries, current].slice(-MAX_HISTORY));
    // 新的改动让重做链失效
    setFuture([]);
  }, []);

  const commit = useCallback((current: VideoEditorTrack[]) => {
    interactionActiveRef.current = false;
    recordSnapshot(current);
  }, [recordSnapshot]);

  const begin = useCallback((current: VideoEditorTrack[]) => {
    if (interactionActiveRef.current) return;
    interactionActiveRef.current = true;
    recordSnapshot(current);
  }, [recordSnapshot]);

  const end = useCallback(() => {
    interactionActiveRef.current = false;
  }, []);

  const undo = useCallback((current: VideoEditorTrack[]) => {
    interactionActiveRef.current = false;
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    setPast((entries) => entries.slice(0, -1));
    setFuture((entries) => [...entries, current]);
    return previous;
  }, [past]);

  const redo = useCallback((current: VideoEditorTrack[]) => {
    interactionActiveRef.current = false;
    if (future.length === 0) return null;
    const next = future[future.length - 1];
    setFuture((entries) => entries.slice(0, -1));
    setPast((entries) => [...entries, current]);
    return next;
  }, [future]);

  const reset = useCallback(() => {
    interactionActiveRef.current = false;
    setPast([]);
    setFuture([]);
  }, []);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    commit,
    begin,
    end,
    undo,
    redo,
    reset,
  };
}

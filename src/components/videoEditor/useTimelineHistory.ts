/**
 * 时间轴撤销重做 —— 对轨道数组做快照。
 *
 * 剪辑工程体量小（片段是元数据，不含媒体），整份快照比记录反向操作简单可靠；
 * 连续拖拽这类高频改动由调用方决定何时落一个快照。
 */
import { useCallback, useState } from 'react';
import type { VideoEditorTrack } from '../../types/videoEditor';

/** 快照上限，防止长时间编辑把内存吃掉 */
const MAX_HISTORY = 50;

export interface TimelineHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** 在改动发生「之前」记录当前状态 */
  commit: (current: VideoEditorTrack[]) => void;
  undo: (current: VideoEditorTrack[]) => VideoEditorTrack[] | null;
  redo: (current: VideoEditorTrack[]) => VideoEditorTrack[] | null;
  reset: () => void;
}

export function useTimelineHistory(): TimelineHistory {
  const [past, setPast] = useState<VideoEditorTrack[][]>([]);
  const [future, setFuture] = useState<VideoEditorTrack[][]>([]);

  const commit = useCallback((current: VideoEditorTrack[]) => {
    setPast((entries) => [...entries, current].slice(-MAX_HISTORY));
    // 新的改动让重做链失效
    setFuture([]);
  }, []);

  const undo = useCallback((current: VideoEditorTrack[]) => {
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    setPast((entries) => entries.slice(0, -1));
    setFuture((entries) => [...entries, current]);
    return previous;
  }, [past]);

  const redo = useCallback((current: VideoEditorTrack[]) => {
    if (future.length === 0) return null;
    const next = future[future.length - 1];
    setFuture((entries) => entries.slice(0, -1));
    setPast((entries) => [...entries, current]);
    return next;
  }, [future]);

  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    commit,
    undo,
    redo,
    reset,
  };
}

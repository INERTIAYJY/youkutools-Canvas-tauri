/**
 * ShotlistNode 分镜表 —— 一行一个镜头的可编辑表格
 *
 * 与「宫格分镜」（ai-storyboard）职责不同：那个把一张成图切格取裁片，
 * 这里是前期分镜稿本身。每行的「画面」格引用画布上一个图像/视频节点，
 * 整表可以按行推成视频编辑器的时间轴。
 *
 * 画面格持有的是引用而非所有权：渲染与推送都读画布上那个节点的实时数据，
 * 源节点重新生成后画面自动跟着变；节点不在了才回落到绑定时的快照。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import type { BaseNodeData, ShotlistColumnKey, ShotRow } from '../../types';
import {
  SHOT_CAMERA_OPTIONS,
  SHOT_SIZE_OPTIONS,
  SHOT_TRANSITION_OPTIONS,
  SHOTLIST_COLUMN_LABELS,
  SHOTLIST_COLUMN_ORDER,
  SHOTLIST_DEFAULT_COLUMNS,
  SHOTLIST_OPTIONAL_COLUMNS,
  SHOTLIST_PINNED_COLUMNS,
  computeShotlistDuration,
  createShotRow,
} from '../../types';
import NodeLabel from './shared/NodeLabel';
import GooeyBtn from './shared/GooeyBtn';
import ResizeHandle from './shared/ResizeHandle';
import NodeError from './shared/NodeError';
import { useNodeRename } from './shared/useNodeRename';
import { useAppStore, generateId } from '../../store/useAppStore';
import { hasShotlistTimeline, openVideoEditorForShotlist } from '../../services/videoEditorService';

/** 画面格实时解析出的素材 */
interface ResolvedFrame {
  url?: string;
  kind: 'image' | 'video';
  /** 源节点已不在画布上，当前显示的是绑定时的快照 */
  dangling: boolean;
}

/** 纯文本列：直接一个多行输入框 */
const TEXT_COLUMNS: ShotlistColumnKey[] = ['content', 'dialogue', 'audio', 'note'];

/** 带候选值的列：下拉给建议，仍可自由输入 */
const OPTION_COLUMNS: Record<string, readonly string[]> = {
  shotSize: SHOT_SIZE_OPTIONS,
  camera: SHOT_CAMERA_OPTIONS,
  transition: SHOT_TRANSITION_OPTIONS.map((option) => option.label),
};

function ShotlistNode({ id, data, selected }: { id: string; data: BaseNodeData; selected?: boolean }) {
  const updateNodeDataTransient = useAppStore((s) => s.updateNodeDataTransient);
  const commitToHistory = useAppStore((s) => s.commitToHistory);
  const setSelectedNodeIds = useAppStore((s) => s.setSelectedNodeIds);
  const { setCenter, getNode } = useReactFlow();

  const nodeWidth = (data.nodeWidth as number) || 720;
  const nodeHeight = (data.nodeHeight as number) || 380;

  // 字段缺省时每次渲染都会是新数组，会让下游 useMemo 依赖恒变
  const rows = useMemo(
    () => (data.shotlistRows as ShotRow[] | undefined) ?? [],
    [data.shotlistRows],
  );
  const columns = useMemo(
    () => (data.shotlistColumns as ShotlistColumnKey[] | undefined) ?? SHOTLIST_DEFAULT_COLUMNS,
    [data.shotlistColumns],
  );

  // 常驻列不受配置影响，避免存量数据把表结构裁没了
  const visibleColumns = useMemo(() => {
    const enabled = new Set<ShotlistColumnKey>([...SHOTLIST_PINNED_COLUMNS, ...columns]);
    return SHOTLIST_COLUMN_ORDER.filter((key) => enabled.has(key));
  }, [columns]);

  /**
   * 画面格实时解析：读画布上被引用节点的当前素材，源节点不在了才回落到快照。
   *
   * 选择器刻意返回 JSON 字符串而不是对象/Map——返回值按值比较，
   * 画布上任何无关节点的拖动都不会让这张表重渲染，只有被引用素材真的变了才触发。
   */
  const frameEntriesJson = useAppStore((s) => JSON.stringify(
    rows.flatMap<[string, ResolvedFrame]>((row) => {
      const frame = row.frame;
      if (!frame) return [];
      const source = s.nodes.find((candidate) => candidate.id === frame.nodeId);
      if (!source) return [[row.id, { url: frame.url, kind: frame.kind, dangling: true }]];
      const isVideo = source.type === 'ai-video' || source.type === 'source-video';
      const url = (isVideo
        ? (source.data.thumbnailUrl || source.data.videoUrl)
        : (source.data.imageUrl || source.data.thumbnailUrl)) as string | undefined;
      return [[row.id, { url: url ?? frame.url, kind: isVideo ? 'video' : 'image', dangling: false }]];
    }),
  ));

  const resolvedFrames = useMemo(
    () => new Map<string, ResolvedFrame>(JSON.parse(frameEntriesJson) as [string, ResolvedFrame][]),
    [frameEntriesJson],
  );

  const totalDuration = useMemo(() => computeShotlistDuration(rows), [rows]);

  const [columnMenuRequested, setColumnMenuRequested] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const writeRows = useCallback(
    (next: ShotRow[]) => updateNodeDataTransient(id, { shotlistRows: next } as Partial<BaseNodeData>),
    [id, updateNodeDataTransient],
  );

  /** 输入过程中只改数据不落历史，失焦时再提交，避免每敲一个字produce一条撤销记录 */
  const patchRow = useCallback(
    (rowId: string, patch: Partial<ShotRow>) => {
      writeRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
    },
    [rows, writeRows],
  );

  const addRow = useCallback(() => {
    commitToHistory();
    writeRows([...rows, createShotRow(`shot-${generateId()}`, rows.length + 1)]);
    commitToHistory();
  }, [rows, writeRows, commitToHistory]);

  const deleteRow = useCallback(
    (rowId: string) => {
      commitToHistory();
      writeRows(rows.filter((row) => row.id !== rowId));
      commitToHistory();
    },
    [rows, writeRows, commitToHistory],
  );

  const moveRow = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const from = rows.findIndex((row) => row.id === fromId);
      const to = rows.findIndex((row) => row.id === toId);
      if (from < 0 || to < 0) return;
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      commitToHistory();
      writeRows(next);
      commitToHistory();
    },
    [rows, writeRows, commitToHistory],
  );

  const toggleColumn = useCallback(
    (key: ShotlistColumnKey) => {
      const enabled = new Set(columns);
      if (enabled.has(key)) enabled.delete(key);
      else enabled.add(key);
      commitToHistory();
      updateNodeDataTransient(id, {
        shotlistColumns: SHOTLIST_COLUMN_ORDER.filter((column) => enabled.has(column)),
      } as Partial<BaseNodeData>);
    },
    [columns, id, updateNodeDataTransient, commitToHistory],
  );

  const unbindFrame = useCallback(
    (rowId: string) => {
      commitToHistory();
      patchRow(rowId, { frame: null });
      commitToHistory();
    },
    [patchRow, commitToHistory],
  );

  /** 点击已绑画面 → 把画布移到那个源节点并选中它 */
  const focusFrameNode = useCallback(
    (nodeId: string) => {
      const target = getNode(nodeId);
      if (!target) return;
      const width = (target.measured?.width ?? 200) / 2;
      const height = (target.measured?.height ?? 200) / 2;
      setCenter(target.position.x + width, target.position.y + height, { zoom: 1, duration: 400 });
      setSelectedNodeIds([nodeId]);
    },
    [getNode, setCenter, setSelectedNodeIds],
  );

  const pushToTimeline = useCallback(async () => {
    const store = useAppStore.getState();
    const projectId = store.currentProjectId ?? '';
    try {
      // 分镜表是时间轴的源，每次推送都按当前表重建，会覆盖上次在剪辑窗口里的调整
      if (await hasShotlistTimeline(projectId, id)) {
        const confirmed = window.confirm('这张分镜表已经推送过时间轴。继续将按当前表重建，剪辑窗口里的调整会丢失。');
        if (!confirmed) return;
      }
      await openVideoEditorForShotlist({
        projectId,
        nodeId: id,
        label: (data.label as string) || '分镜表',
        rows,
        theme: store.config.theme === 'light' ? 'light' : 'dark',
      });
    } catch (err: unknown) {
      store.showToast(err instanceof Error ? err.message : '推送时间轴失败', 'error');
    }
  }, [id, data.label, rows]);

  const handleResize = useCallback(
    (w: number, h: number) => updateNodeDataTransient(id, { nodeWidth: w, nodeHeight: h } as Partial<BaseNodeData>),
    [id, updateNodeDataTransient],
  );

  // 取消选中即收起：派生而非用 effect 回写，避免多一轮渲染
  const columnMenuOpen = columnMenuRequested && !!selected;

  // 点击外部关闭列菜单
  useEffect(() => {
    if (!columnMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Element)) {
        setColumnMenuRequested(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [columnMenuOpen]);

  const { displayLabel, handleRename } = useNodeRename(id, data, '分镜表');

  const renderCell = (row: ShotRow, column: ShotlistColumnKey) => {
    if (column === 'frame') {
      const frame = resolvedFrames.get(row.id);
      if (!row.frame) {
        return (
          <div className="shot-frame shot-frame--empty" data-shot-frame-row={row.id}>
            <Icon icon="mdi:plus" width={16} height={16} aria-hidden="true" />
            <span className="shot-frame-hint">拖入画面</span>
          </div>
        );
      }
      return (
        <div
          className={`shot-frame${frame?.dangling ? ' shot-frame--dangling' : ''}`}
          data-shot-frame-row={row.id}
        >
          {frame?.url ? (
            <img
              className="shot-frame-img"
              src={frame.url}
              alt=""
              draggable={false}
              onClick={() => focusFrameNode(row.frame!.nodeId)}
              title={frame.dangling ? '源节点已不在画布上，显示的是快照' : '点击定位到源节点'}
            />
          ) : (
            <span className="shot-frame-hint">无预览</span>
          )}
          {frame?.kind === 'video' && (
            <Icon className="shot-frame-badge" icon="mdi:play-circle" width={14} height={14} aria-hidden="true" />
          )}
          <button
            type="button"
            className="shot-frame-unbind nodrag"
            onClick={() => unbindFrame(row.id)}
            title="解除绑定"
            aria-label="解除绑定"
          >
            <Icon icon="mdi:close" width={11} height={11} />
          </button>
        </div>
      );
    }

    if (column === 'shotNo') {
      return (
        <input
          className="shot-input shot-input--no nodrag"
          value={row.shotNo}
          onChange={(e) => patchRow(row.id, { shotNo: e.target.value })}
          onBlur={commitToHistory}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );
    }

    if (column === 'duration') {
      return (
        <input
          className="shot-input shot-input--duration nodrag"
          type="number"
          min={0}
          step={0.5}
          value={row.duration ?? ''}
          onChange={(e) => patchRow(row.id, {
            duration: e.target.value === '' ? undefined : Number(e.target.value),
          })}
          onBlur={commitToHistory}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );
    }

    const options = OPTION_COLUMNS[column];
    if (options) {
      const listId = `${id}-${column}`;
      return (
        <>
          <input
            className="shot-input nodrag"
            list={listId}
            value={(row[column] as string) ?? ''}
            onChange={(e) => patchRow(row.id, { [column]: e.target.value } as Partial<ShotRow>)}
            onBlur={commitToHistory}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <datalist id={listId}>
            {options.map((option) => <option key={option} value={option} />)}
          </datalist>
        </>
      );
    }

    if (TEXT_COLUMNS.includes(column)) {
      return (
        <textarea
          className="shot-input shot-input--text nodrag nowheel"
          rows={2}
          value={(row[column] as string) ?? ''}
          onChange={(e) => patchRow(row.id, { [column]: e.target.value } as Partial<ShotRow>)}
          onBlur={commitToHistory}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );
    }

    return null;
  };

  return (
    <div className="node-wrapper relative" style={{ width: nodeWidth }}>
      <NodeLabel
        kind="ai-shotlist"
        label={displayLabel}
        displayId={data.displayId as number | undefined}
        nodeId={id}
        onRename={handleRename}
      />
      <div className={`node shotlist-node ${selected ? 'selected' : ''}`} style={{ height: nodeHeight }}>
        {/* 工具条本身不加 nodrag：表体几乎被输入框占满，这条带子是节点主要的拖拽手柄 */}
        <div className="shotlist-toolbar">
          <span className="shotlist-stat">
            共 {rows.length} 镜 · 总时长 {Number(totalDuration.toFixed(1))}″
          </span>
          <div className="shotlist-toolbar-actions nodrag" ref={columnMenuRef}>
            <button
              type="button"
              className="shotlist-btn"
              onClick={() => setColumnMenuRequested((open) => !open)}
              title="选择显示的列"
            >
              <Icon icon="mdi:view-column-outline" width={13} height={13} />
              列
            </button>
            {columnMenuOpen && (
              <div className="shotlist-column-menu nowheel">
                {SHOTLIST_OPTIONAL_COLUMNS.map((key) => (
                  <label key={key} className="shotlist-column-item">
                    <input
                      type="checkbox"
                      checked={columns.includes(key)}
                      onChange={() => toggleColumn(key)}
                    />
                    {SHOTLIST_COLUMN_LABELS[key]}
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              className="shotlist-btn shotlist-btn--primary"
              onClick={pushToTimeline}
              title="按当前表重建剪辑时间轴"
            >
              <Icon icon="mdi:timeline-plus-outline" width={13} height={13} />
              推送时间轴
            </button>
          </div>
        </div>

        <div className="shotlist-scroll nowheel">
          <table className="shotlist-table">
            <thead>
              <tr>
                <th className="shot-col-grip" aria-label="排序" />
                {visibleColumns.map((column) => (
                  <th key={column} className={`shot-col-${column}`}>{SHOTLIST_COLUMN_LABELS[column]}</th>
                ))}
                <th className="shot-col-actions" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={dragRowId === row.id ? 'shot-row--dragging' : ''}
                  onDragOver={(e) => { if (dragRowId) e.preventDefault(); }}
                  onDrop={(e) => {
                    if (!dragRowId) return;
                    e.preventDefault();
                    moveRow(dragRowId, row.id);
                    setDragRowId(null);
                  }}
                >
                  <td className="shot-col-grip">
                    <span
                      className="shot-grip nodrag"
                      draggable
                      onDragStart={() => setDragRowId(row.id)}
                      onDragEnd={() => setDragRowId(null)}
                      title="拖动调整顺序"
                    >
                      <Icon icon="mdi:drag-horizontal-variant" width={13} height={13} />
                    </span>
                  </td>
                  {visibleColumns.map((column) => (
                    <td key={column} className={`shot-col-${column}`}>{renderCell(row, column)}</td>
                  ))}
                  <td className="shot-col-actions">
                    <button
                      type="button"
                      className="shot-row-delete nodrag"
                      onClick={() => deleteRow(row.id)}
                      title="删除该镜"
                      aria-label="删除该镜"
                    >
                      <Icon icon="mdi:trash-can-outline" width={13} height={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="shotlist-empty">还没有镜头，点下面「加一镜」开始</div>
          )}
        </div>

        <button type="button" className="shotlist-add nodrag" onClick={addRow}>
          <Icon icon="mdi:plus" width={13} height={13} />
          加一镜
        </button>

        {data.error && <NodeError nodeId={id} message={data.error} />}

        <Handle type="target" position={Position.Left} id="left" className="node-handle handle-target handle-shotlist">
          <GooeyBtn className="gooey-btn-left" hue={40} />
        </Handle>
        <Handle type="source" position={Position.Right} id="right" className="node-handle handle-source handle-shotlist">
          <GooeyBtn className="gooey-btn-right" hue={40} />
        </Handle>
      </div>

      <ResizeHandle
        nodeId={id}
        currentWidth={nodeWidth}
        currentHeight={nodeHeight}
        minWidth={420}
        minHeight={220}
        onResizeStart={commitToHistory}
        onResizeEnd={commitToHistory}
        onResize={handleResize}
      />
    </div>
  );
}

export default memo(ShotlistNode);

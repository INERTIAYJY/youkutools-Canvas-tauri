/**
 * ShotlistFieldEditor — 提供分镜字段编辑界面与交互。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n';
import { SHOTLIST_COLUMN_LABELS } from '../../types';
import ModalOverlay from '../shared/ModalOverlay';
import PopupCloseButton from '../shared/PopupCloseButton';
import MarkdownEditor, { type MarkdownSourceEditor } from '../shared/MarkdownEditor';
import ReferencePreviewBody from '../shared/ReferencePreviewBody';
import MentionEditor, { type MentionEditorHandle } from './shared/MentionEditor';

const renderPreview = (value: string, markdown: boolean) => <ReferencePreviewBody value={value} markdown={markdown} />;

/** 单个镜头字段的全屏编辑入口；引用预览仍由原只读查看器处理。 */
export default function ShotlistFieldEditor({ nodeId, rowId, field, projectId, onClose }: {
  nodeId: string;
  rowId: string;
  field: 'content' | 'dialogue';
  projectId: string | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const node = useAppStore((state) => (state.currentProjectId ?? undefined) === projectId
    ? state.nodes.find((item) => item.id === nodeId && item.data.type === 'ai-shotlist') : undefined);
  const projectReady = useAppStore((state) => state.projectLoadStatus === 'ready' && !state.isCreatingProject
    && !state.isReturningToStartPage && state.switchingProjectName === null);
  const row = node?.data.shotlistRows?.find((item) => item.id === rowId);
  const [draft, setDraft] = useState(row?.[field] ?? '');
  const expectedValue = useRef(draft);
  const changed = useRef(false);
  const active = useRef(true);
  const editor = useRef<MentionEditorHandle>(null);
  const readOnly = !projectReady || !row || node?.data.status === 'loading' || (row[field] ?? '') !== draft;
  const label = t(SHOTLIST_COLUMN_LABELS[field]);
  const title = `${node?.data.label || t('分镜表')} · ${row?.shotNo || rowId} · ${label}`;

  const finish = useCallback(() => {
    if (!changed.current) return;
    changed.current = false;
    const state = useAppStore.getState();
    const latest = state.nodes.find((item) => item.id === nodeId)?.data.shotlistRows?.find((item) => item.id === rowId);
    if ((state.currentProjectId ?? undefined) === projectId && state.projectLoadStatus === 'ready'
      && latest && (latest[field] ?? '') === expectedValue.current) state.commitToHistory();
  }, [nodeId, rowId, field, projectId]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; finish(); };
  }, [finish]);
  useEffect(() => { editor.current?.textInput?.focus({ preventScroll: true }); }, []);

  const change = useCallback((value: string) => {
    const state = useAppStore.getState();
    const latestNode = state.nodes.find((item) => item.id === nodeId && item.data.type === 'ai-shotlist');
    const rows = latestNode?.data.shotlistRows;
    const latest = rows?.find((item) => item.id === rowId);
    if (!active.current || (state.currentProjectId ?? undefined) !== projectId || !latest || !rows || latestNode?.data.status === 'loading'
      || state.projectLoadStatus !== 'ready' || state.isCreatingProject || state.isReturningToStartPage || state.switchingProjectName !== null
      || (latest[field] ?? '') !== expectedValue.current || value === expectedValue.current) return;
    if (!changed.current) state.commitToHistory();
    changed.current = true;
    expectedValue.current = value;
    setDraft(value);
    state.updateNodeDataTransient(nodeId, { shotlistRows: rows.map((item) => item.id === rowId ? { ...item, [field]: value } : item) });
  }, [nodeId, rowId, field, projectId]);
  const close = useCallback(() => { active.current = false; finish(); onClose(); }, [finish, onClose]);
  const dismiss = useCallback(() => { if (!editor.current?.dismissMenu?.()) close(); }, [close]);
  const sourceEditor = useMemo<MarkdownSourceEditor>(() => ({
    getInput: () => editor.current?.textInput ?? null,
    render: ({ value, onChange, onBlur, readOnly: disabled, label: ariaLabel }) => <MentionEditor ref={editor}
      nodeId={nodeId} value={value} onChange={onChange} onBlur={onBlur} disabled={disabled}
      ariaLabel={ariaLabel} canSubmit={false} submitShortcut="ctrl-enter" portalDropdown placeholder=""
      className="h-full [&_.prompt-editor]:min-h-full [&_.prompt-editor]:max-h-none [&_.prompt-editor]:overflow-visible [&_.prompt-editor]:leading-[inherit]" />,
  }), [nodeId]);
  const details = [
    { label: '来源节点', value: node?.data.label || t('分镜表') },
    { label: '节点编号', value: node?.data.displayId != null ? `#${node.data.displayId}` : '—' },
    { label: '镜头编号', value: row?.shotNo || '—' },
    { label: '景别', value: row?.shotSize || '—' },
    { label: '运镜', value: row?.camera || '—' },
    { label: '镜头时长', value: row?.duration != null ? `${row.duration} ${t('秒')}` : '—' },
  ];
  return <ModalOverlay isOpen onClose={dismiss} ariaLabel={title} className="asset-image-preview reference-content-preview"
    zIndex={410} motionPreset="quick" backdropBlur={false} closeOnBackdrop={false}>
    <div data-reference-preview-open="" data-reference-owner-node-id={nodeId} className="asset-image-preview-layout">
      <div className="asset-image-preview-stage">
        <MarkdownEditor value={draft} onChange={change} onSave={finish} initialMode="source" label={label}
          readOnly={readOnly} sourceEditor={sourceEditor} renderPreview={renderPreview}
          status={t(readOnly ? '镜头内容已变化，请关闭后重新打开' : '编辑后自动保存')} />
      </div>
      <aside className="asset-image-preview-info" aria-label={t('相关信息')}>
        <header className="flex shrink-0 items-start gap-3">
          <Icon icon="lucide:file-pen-line" className="mt-1 h-5 w-5 shrink-0 text-canvas-text-secondary" aria-hidden="true" />
          <div className="min-w-0 flex-1"><h1 className="break-words text-sm font-semibold text-canvas-text">{title}</h1>
            <p className="pt-1 text-xs text-canvas-text-muted">{label}</p></div>
          <PopupCloseButton onClick={close} />
        </header>
        <div className="asset-image-preview-info-content space-y-3">
          <section className="ui-card asset-image-preview-section p-3" aria-label={t('相关信息')}>
            <h2 className="pb-2 text-xs font-medium text-canvas-text-secondary">{t('相关信息')}</h2>
            <dl className="space-y-3">{details.map((detail) => <div key={detail.label}>
              <dt className="text-xs text-canvas-text-muted">{t(detail.label)}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-canvas-text">{detail.value}</dd>
            </div>)}</dl>
          </section>
        </div>
      </aside>
    </div>
  </ModalOverlay>;
}

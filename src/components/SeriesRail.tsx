/**
 * SeriesRail 剧集栏 — 贴在窗口右缘的常驻按钮，悬浮展开后即使移走鼠标也保持显示；
 * 收起只能通过面板右上角的关闭按钮。分集各自是一张画布，点一下就切过去；
 * 原著与剧本挂在剧集项目上，整部剧共用。
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { listEpisodes, seriesOwnerId } from '../store/store.utils';
import { getProjectDataDir, uploadSourceFileToProject } from '../services/fileService';
import ModalOverlay from './shared/ModalOverlay';
import PopupCloseButton from './shared/PopupCloseButton';
import ProjectAssetsOverlay from './ProjectAssetsOverlay';

const SPLIT_PROMPT = '先用 series_read 读完当前剧集的剧本（没有剧本就读原著），'
  + '按剧情节奏把它拆成若干集，每集给出标题和一段大纲，'
  + '再用 series_split_episodes 批量创建分集画布。';

/** 原著文件落在项目数据目录里，只存相对路径，换机器或导入后仍能定位。 */
function toProjectRelativePath(filePath: string, projectDir: string | null): string {
  const path = filePath.replace(/\\/g, '/');
  const dir = (projectDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (dir && path.toLowerCase().startsWith(`${dir.toLowerCase()}/`)) {
    return path.slice(dir.length + 1);
  }
  return path.split('/').pop() ?? path;
}

/** 草稿由打开它的那次点击初始化，弹窗自己只管编辑，不用 effect 去同步外部值。 */
function TextEditorDialog({
  isOpen,
  title,
  hint,
  draft,
  onDraftChange,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  title: string;
  hint: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onClose: () => void;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (await onSave(draft)) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose} ariaLabel={title}>
      <div
        className="glass-bevel glass-bevel--panel flex h-[min(72vh,640px)] w-[min(680px,calc(100vw-32px))]
                   flex-col overflow-hidden rounded-lg border border-[var(--glass-ring)]
                   bg-[var(--glass-bg)] text-canvas-text shadow-2xl shadow-black/40 backdrop-blur-2xl"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-500/15 text-indigo-400">
            <Icon icon="lucide:scroll-text" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold leading-5">{title}</h2>
            <p className="truncate text-[11px] leading-4 text-canvas-text-muted">{hint}</p>
          </div>
          <PopupCloseButton ariaLabel={`关闭${title}`} onClick={onClose} />
        </header>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed
                     text-canvas-text outline-none placeholder:text-canvas-text-muted"
          placeholder="粘贴或输入正文…"
        />
        <footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4">
          <span className="text-[11px] text-canvas-text-muted">{draft.length} 字</span>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => { void submit(); }}
            className="h-8 rounded-lg bg-indigo-500/90 px-4 text-xs font-medium text-white
                       transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
          >
            {isSaving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

export default function SeriesRail() {
  const {
    projects, currentProjectId, projectLoadStatus,
    switchProject, addEpisode, updateSeriesInfo, updateEpisodeOutline,
    moveEpisode, renameProject, deleteProject, showToast, openChatWithDraft,
  } = useAppStore(useShallow((state) => ({
    projects: state.projects,
    currentProjectId: state.currentProjectId,
    projectLoadStatus: state.projectLoadStatus,
    switchProject: state.switchProject,
    addEpisode: state.addEpisode,
    updateSeriesInfo: state.updateSeriesInfo,
    updateEpisodeOutline: state.updateEpisodeOutline,
    moveEpisode: state.moveEpisode,
    renameProject: state.renameProject,
    deleteProject: state.deleteProject,
    showToast: state.showToast,
    openChatWithDraft: state.openChatWithDraft,
  })));

  const [busy, setBusy] = useState<string | null>(null);
  // 浮起即勾上 pinned：触条常驻、点 X 才收；未浮起时是隐藏态
  const [pinned, setPinned] = useState(false);
  // 资产浮层：双击竖线打开，关闭按钮收起
  const [assetsOpen, setAssetsOpen] = useState(false);
  // 区分单击 / 双击：单击延迟执行，双击时取消
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 打开编辑器时就把草稿装好，弹窗内部不用再和外部值同步
  const [editor, setEditor] = useState<{ kind: 'script' | 'outline'; draft: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // 这两个都按分集 id 存：切到别的剧集后对不上任何一行，自然失效
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const seriesId = currentProjectId ? seriesOwnerId(projects, currentProjectId) : null;
  const series = projects.find((project) => project.id === seriesId) ?? null;
  const episodes = useMemo(
    () => (seriesId ? listEpisodes(projects, seriesId) : []),
    [projects, seriesId],
  );
  const currentEpisode = projects.find((project) => project.id === currentProjectId) ?? null;
  const originalWork = series?.series?.originalWork;
  const script = series?.series?.script ?? '';

  if (!currentProjectId || !series) return null;
  const ready = projectLoadStatus === 'ready';

  const runBusy = async (key: string, task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  const handleUploadOriginal = () => runBusy('original', async () => {
    const uploaded = await uploadSourceFileToProject('txt,md', currentProjectId);
    if (!uploaded) return;
    if (!uploaded.filePath) {
      showToast('原著需要保存到项目目录，请在桌面端添加', 'error');
      return;
    }
    const projectDir = await getProjectDataDir(currentProjectId);
    await updateSeriesInfo({
      originalWork: {
        fileName: uploaded.fileName,
        relativePath: toProjectRelativePath(uploaded.filePath, projectDir),
        addedAt: Date.now(),
      },
    });
  });

  const handleRemoveOriginal = () => runBusy('original', async () => {
    // 只解除引用，文件留在项目目录里，避免误删用户的原稿。
    await updateSeriesInfo({ originalWork: undefined });
  });

  const submitRename = async () => {
    const target = renamingId;
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!target || !name) return;
    await renameProject(target, name);
  };

  return (
    <>
      <div
        className="group/series pointer-events-none fixed right-0 top-1/2 z-[150] flex h-[min(70vh,560px)]
                   w-6 -translate-y-1/2 items-center justify-end"
      >
        <button
          type="button"
          aria-label="展开剧集栏（双击打开项目资产）"
          data-tooltip="单击：展开剧集栏｜双击：打开项目资产"
          onClick={() => {
            // 清除之前的定时器（如果有）
            if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
            // 延迟 200ms 执行单击逻辑；如果在此期间触发双击，定时器会被清除
            singleClickTimer.current = setTimeout(() => {
              singleClickTimer.current = null;
              setPinned(true);
            }, 200);
          }}
          onDoubleClick={() => {
            // 双击：取消单击的延迟，直接打开资产浮层
            if (singleClickTimer.current) {
              clearTimeout(singleClickTimer.current);
              singleClickTimer.current = null;
            }
            setAssetsOpen(true);
          }}
          className={`pointer-events-auto absolute right-2.5 h-20 w-[3px] rounded-full
                     bg-canvas-text-muted transition-all duration-150
                     ${pinned ? 'opacity-0 scale-100' : 'opacity-40 hover:opacity-70 hover:scale-[1.2]'}`}
        />
        <aside
          aria-label="剧集"
          aria-hidden={!pinned}
          className={`glass-bevel glass-bevel--panel absolute right-2.5 top-1/2 flex max-h-full
                     w-[min(360px,calc(100vw-32px))] -translate-y-1/2 flex-col overflow-hidden
                     rounded-[14px] border border-[var(--glass-ring)] bg-[var(--glass-bg)]
                     text-canvas-text shadow-2xl shadow-black/40 backdrop-blur-2xl
                     transition-[transform,opacity] duration-200 ease-out will-change-transform
                     motion-reduce:transition-opacity ${
                       pinned
                         ? 'pointer-events-auto translate-x-0 opacity-100'
                         : 'pointer-events-none translate-x-[calc(100%+1.5rem)] opacity-0'
                     }`}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle p-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-indigo-500/15 text-indigo-400">
              <Icon icon="lucide:clapperboard" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-4">{series.name}</p>
              <p className="truncate text-[10px] leading-4 text-canvas-text-muted">
                {episodes.length > 0 ? `共 ${episodes.length} 集` : '还没有分集'}
              </p>
            </div>
            <PopupCloseButton ariaLabel="收起剧集栏" onClick={() => setPinned(false)} />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
            <section className="grid gap-2 border-b border-border-subtle p-2">
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-canvas-text-secondary">
                    <Icon icon="lucide:book-open" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">原著</span>
                  </div>
                  <div className="flex h-8 items-center gap-1 rounded-lg border border-canvas-border bg-canvas-card px-2 leading-none">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-canvas-text-secondary">
                      {originalWork?.fileName ?? '未添加（txt / md）'}
                    </span>
                    <button
                      type="button"
                      disabled={!ready || busy !== null}
                      onClick={() => { void handleUploadOriginal(); }}
                      data-tooltip={originalWork ? '更换原著文件' : '添加原著文件'}
                      aria-label={originalWork ? '更换原著文件' : '添加原著文件'}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-canvas-text-muted
                                 transition-colors hover:bg-canvas-hover hover:text-canvas-text
                                 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon icon={originalWork ? 'lucide:refresh-cw' : 'lucide:upload'} className="h-3.5 w-3.5" />
                    </button>
                    {originalWork ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => { void handleRemoveOriginal(); }}
                        data-tooltip="移除引用（不删文件）"
                        aria-label="移除原著引用"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-canvas-text-muted
                                   transition-colors hover:bg-red-500/15 hover:text-red-400
                                   disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Icon icon="lucide:x" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-canvas-text-secondary">
                    <Icon icon="lucide:scroll-text" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">剧本</span>
                  </div>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => setEditor({ kind: 'script', draft: script })}
                    className="flex h-8 items-center gap-1 rounded-lg border border-canvas-border bg-canvas-card
                               px-2 text-left leading-none transition-colors hover:bg-canvas-hover
                               disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-canvas-text-secondary">
                      {script ? `${script.length} 字` : '未填写，点击编辑'}
                    </span>
                    <Icon icon="lucide:pencil" className="h-3.5 w-3.5 shrink-0 text-canvas-text-muted" />
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-1.5 border-t border-border-subtle p-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-canvas-text-secondary">
                <Icon icon="lucide:list-video" className="h-3.5 w-3.5" />
                分集
              </div>

              {episodes.map((episode, index) => {
                const isCurrent = episode.id === currentProjectId;
                const isRenaming = renamingId === episode.id;

                return (
                  <div
                    key={episode.id}
                    className={`group/episode flex items-center gap-1 rounded-lg px-1.5 h-7 transition-colors ${
                      isCurrent ? 'bg-[var(--white-alpha-06)]' : 'hover:bg-canvas-hover'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isCurrent ? 'bg-indigo-400 shadow-sm shadow-indigo-500/50' : 'bg-canvas-text-muted/30'
                      }`}
                    />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => { void submitRename(); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') setRenamingId(null);
                        }}
                        aria-label="分集名称"
                        className="min-w-0 flex-1 h-full rounded-md bg-canvas-bg/60 px-1.5 text-[11px] leading-none
                                   text-canvas-text outline-none ring-1 ring-inset ring-indigo-400/50"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => { if (!isCurrent) void switchProject(episode.id); }}
                        onDoubleClick={() => {
                          setRenamingId(episode.id);
                          setRenameDraft(episode.name);
                        }}
                        aria-current={isCurrent}
                        data-tooltip={`${episode.name}（双击改名）`}
                        className={`min-w-0 flex-1 truncate px-1 text-left text-[11px] leading-none transition-colors ${
                          isCurrent ? 'text-canvas-text' : 'text-canvas-text-muted hover:text-canvas-text-secondary'
                        }`}
                      >
                        {episode.name}
                      </button>
                    )}

                    <div className="flex shrink-0 items-center opacity-0 transition-opacity
                                    group-hover/episode:opacity-100 group-focus-within/episode:opacity-100">
                      <button
                        type="button"
                        disabled={index === 0 || busy !== null}
                        onClick={() => { void runBusy('move', () => moveEpisode(episode.id, -1)); }}
                        aria-label={`把 ${episode.name} 上移`}
                        className="grid h-5 w-5 place-items-center rounded text-canvas-text-muted
                                   transition-colors hover:bg-canvas-hover hover:text-canvas-text
                                   disabled:cursor-not-allowed disabled:opacity-25"
                      >
                        <Icon icon="lucide:chevron-up" className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === episodes.length - 1 || busy !== null}
                        onClick={() => { void runBusy('move', () => moveEpisode(episode.id, 1)); }}
                        aria-label={`把 ${episode.name} 下移`}
                        className="grid h-5 w-5 place-items-center rounded text-canvas-text-muted
                                   transition-colors hover:bg-canvas-hover hover:text-canvas-text
                                   disabled:cursor-not-allowed disabled:opacity-25"
                      >
                        <Icon icon="lucide:chevron-down" className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (confirmDeleteId === episode.id) {
                            setConfirmDeleteId(null);
                            void runBusy('delete', () => deleteProject(episode.id));
                            return;
                          }
                          setConfirmDeleteId(episode.id);
                        }}
                        aria-label={confirmDeleteId === episode.id
                          ? `确认删除 ${episode.name}`
                          : `删除 ${episode.name}`}
                        data-tooltip={confirmDeleteId === episode.id ? '再点一次确认删除' : '删除这一集'}
                        className={`grid h-5 w-5 place-items-center rounded transition-colors
                                    disabled:cursor-not-allowed disabled:opacity-25 ${
                                      confirmDeleteId === episode.id
                                        ? 'bg-red-500/20 text-red-400'
                                        : 'text-canvas-text-muted hover:bg-red-500/15 hover:text-red-400'
                                    }`}
                      >
                        <Icon icon="lucide:trash-2" className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                disabled={!ready || busy !== null}
                onClick={() => { void runBusy('add', () => addEpisode()); }}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed
                           border-canvas-border py-1.5 text-[11px] text-canvas-text-muted transition-colors
                           hover:border-indigo-400/50 hover:text-canvas-text-secondary
                           disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon icon={busy === 'add' ? 'lucide:loader-2' : 'lucide:plus'}
                  className={`h-3.5 w-3.5 ${busy === 'add' ? 'animate-spin motion-reduce:animate-none' : ''}`}
                />
                {episodes.length > 0 ? '新增分集' : '转为剧集并新增分集'}
              </button>

              {/* 拆分由对话助手完成：把提示词填进输入框，用户确认后再发起。 */}
              <button
                type="button"
                disabled={!ready || busy !== null}
                onClick={() => openChatWithDraft(SPLIT_PROMPT)}
                className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px]
                           text-canvas-text-muted transition-colors hover:bg-canvas-hover
                           hover:text-canvas-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon icon="lucide:wand-sparkles" className="h-3.5 w-3.5" />
                让助手按剧本拆分集
              </button>
            </section>

            {currentEpisode?.parentId ? (
              <section className="grid gap-2 border-t border-border-subtle p-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-canvas-text-secondary">
                  <Icon icon="lucide:notebook-pen" className="h-3.5 w-3.5" />
                  本集大纲
                </div>
                <button
                  type="button"
                  onClick={() => setEditor({
                    kind: 'outline',
                    draft: currentEpisode.episodeOutline ?? '',
                  })}
                  className="flex items-center gap-2 rounded-lg border border-canvas-border bg-canvas-card
                             px-2.5 py-2 text-left transition-colors hover:bg-canvas-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-canvas-text-secondary">
                    {currentEpisode.episodeOutline?.trim() || '未填写，点击编辑'}
                  </span>
                  <Icon icon="lucide:pencil" className="h-3.5 w-3.5 shrink-0 text-canvas-text-muted" />
                </button>
              </section>
            ) : null}
          </div>
        </aside>
      </div>

      <TextEditorDialog
        isOpen={editor?.kind === 'script'}
        title="剧本"
        hint={`${series.name} · 整部剧共用`}
        draft={editor?.draft ?? ''}
        onDraftChange={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
        onClose={() => setEditor(null)}
        onSave={(next) => updateSeriesInfo({ script: next })}
      />
      <TextEditorDialog
        isOpen={editor?.kind === 'outline'}
        title="本集大纲"
        hint={currentEpisode?.name ?? ''}
        draft={editor?.draft ?? ''}
        onDraftChange={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
        onClose={() => setEditor(null)}
        onSave={(next) => (
          currentEpisode
            ? updateEpisodeOutline(currentEpisode.id, next)
            : Promise.resolve(false)
        )}
      />
      {assetsOpen && (
        <ProjectAssetsOverlay
          isOpen={assetsOpen}
          onClose={() => setAssetsOpen(false)}
        />
      )}
    </>
  );
}

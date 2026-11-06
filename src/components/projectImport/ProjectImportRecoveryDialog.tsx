/** 归档更新恢复点；恢复前再次确认，并保留当前状态作为新的恢复点。 */
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { listProjectImportRecoveries, type ProjectImportRecovery } from '../../services/indexedDb/projectImportRepository';
import ModalOverlay from '../shared/ModalOverlay';
import PopupCloseButton from '../shared/PopupCloseButton';
import { useT } from '../../i18n';

export default function ProjectImportRecoveryDialog({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const t = useT(), restore = useAppStore((state) => state.restoreProjectImport);
  const [rows, setRows] = useState<ProjectImportRecovery[]>([]), [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void listProjectImportRecoveries(ownerId).then((result) => { if (active) setRows(result); }, (cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : t('读取恢复点失败'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, t]);
  const runRestore = async () => { if (!selected) return; setBusy(true); setError('');
    try { await restore(ownerId, selected); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('恢复失败')); }
    finally { setBusy(false); } };
  return <ModalOverlay isOpen onClose={() => { if (!busy) onClose(); }} ariaLabel={t('项目导入恢复点')} zIndex={350} closeOnBackdrop={!busy}
    className="ui-dialog-surface flex max-h-[calc(100dvh-24px)] w-[min(560px,calc(100vw-24px))] flex-col">
    <header className="flex items-center justify-between border-b border-canvas-border p-3"><h2 className="text-sm font-semibold text-canvas-text">{t('项目导入恢复点')}</h2><PopupCloseButton disabled={busy} onClick={onClose} /></header>
    <div className="space-y-3 overflow-y-auto p-3 text-xs text-canvas-text-secondary" aria-busy={busy || loading}>
      <p>{t('恢复会替换整部剧的画布、分集、设置与创作资产。当前状态会另存恢复点，聊天和记忆保留。')}</p>
      {loading ? <p role="status">{t('正在读取…')}</p> : !rows.length ? <p>{t('此项目尚无导入恢复点')}</p> : rows.map((row) => <label key={row.id} className="ui-card flex items-center gap-2 p-3">
        <input type="radio" name="project-import-recovery" disabled={busy} checked={selected === row.id} onChange={() => setSelected(row.id)} />
        <span>{new Date(row.createdAt).toLocaleString()} · {t(row.label)} · {row.records.length - 1} {t('个分集')}</span></label>)}
      {selected && <p className="ui-alert">{t('确认将当前项目恢复为所选时间点？')}</p>}
      {error && <p role="alert" className="ui-alert ui-alert--danger">{error}</p>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-canvas-border p-3"><button type="button" className="ui-btn ui-btn--secondary" disabled={busy} onClick={onClose}>{t('取消')}</button>
      <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !selected} onClick={() => void runRestore()}>{t(busy ? '正在恢复…' : '确认恢复')}</button></footer>
  </ModalOverlay>;
}

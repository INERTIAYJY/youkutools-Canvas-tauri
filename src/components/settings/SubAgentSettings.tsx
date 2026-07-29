/**
 * 子智能体设置页：管理用户自建的只读领域子智能体，内置典范只读可复制。
 */
import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import AnimatedButton from '../shared/AnimatedButton';
import { useAppStore } from '../../store/useAppStore';
import {
  duplicateProfileAsDraft,
  mergeSubAgentProfiles,
  SubAgentProfileError,
} from '../../services/chat/subAgentProfileService';
import {
  SUB_AGENT_LIMITS,
  SUB_AGENT_MATERIAL_LABELS,
  SUB_AGENT_MATERIALS,
  type SubAgentMaterial,
  type SubAgentProfile,
  type SubAgentProfileDraft,
} from '../../types/subAgent';

function emptyDraft(): SubAgentProfileDraft {
  return {
    name: '',
    description: '',
    skillId: undefined,
    instructions: '',
    materials: ['mentioned_nodes'],
    maxRounds: SUB_AGENT_LIMITS.defaultRounds,
  };
}


export interface SubAgentProfileListProps {
  profiles: SubAgentProfile[];
  onEdit: (profile: SubAgentProfile) => void;
  onDuplicate: (profile: SubAgentProfile) => void;
  onDelete: (profile: SubAgentProfile) => void;
}

/** 纯展示列表，由 props 驱动以便脱离 Store 单独渲染验证。 */
export function SubAgentProfileList({
  profiles,
  onEdit,
  onDuplicate,
  onDelete,
}: SubAgentProfileListProps) {
  return (
    <div className="space-y-2">
      {profiles.map((profile) => (
        <div
          key={profile.id}
          className="rounded-lg border border-canvas-border bg-canvas-card p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-canvas-text">
                  {profile.name}
                </span>
                {profile.builtIn && (
                  <span className="shrink-0 rounded bg-canvas-hover px-1.5 py-0.5 text-[10px] text-canvas-text-muted">
                    内置
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-canvas-text-secondary">
                {profile.description || '（未填写说明）'}
              </p>
              <p className="mt-1 text-[10px] text-canvas-text-muted">
                材料：{profile.materials.map((m) => SUB_AGENT_MATERIAL_LABELS[m]).join('、')}
                {' · '}最多 {profile.maxRounds} 轮
                {profile.skillId ? ' · 绑定 Skill' : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <AnimatedButton
                onClick={() => onDuplicate(profile)}
                className="rounded p-1.5 text-canvas-text-muted hover:bg-canvas-hover"
                title="复制为自定义副本"
                aria-label={`复制 ${profile.name}`}
              >
                <Icon icon="mdi:content-copy" width="14" />
              </AnimatedButton>
              {!profile.builtIn && (
                <>
                  <AnimatedButton
                    onClick={() => onEdit(profile)}
                    className="rounded p-1.5 text-canvas-text-muted hover:bg-canvas-hover"
                    title="编辑"
                    aria-label={`编辑 ${profile.name}`}
                  >
                    <Icon icon="mdi:pencil" width="14" />
                  </AnimatedButton>
                  <AnimatedButton
                    onClick={() => onDelete(profile)}
                    className="rounded p-1.5 text-canvas-text-muted hover:bg-red-500/10 hover:text-red-500"
                    title="删除"
                    aria-label={`删除 ${profile.name}`}
                  >
                    <Icon icon="mdi:trash-can-outline" width="14" />
                  </AnimatedButton>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SubAgentSettingsProps {
  /** 嵌入到已有标题栏（如 AI 助手面板）时隐藏内部标题，避免重复。 */
  hideHeading?: boolean;
}

export default function SubAgentSettings({ hideHeading }: SubAgentSettingsProps = {}) {
  const subAgentProfiles = useAppStore((state) => state.subAgentProfiles);
  const userSkills = useAppStore((state) => state.userSkills);
  const createSubAgentProfile = useAppStore((state) => state.createSubAgentProfile);
  const updateSubAgentProfile = useAppStore((state) => state.updateSubAgentProfile);
  const deleteSubAgentProfile = useAppStore((state) => state.deleteSubAgentProfile);
  const showToast = useAppStore((state) => state.showToast);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubAgentProfileDraft | null>(null);
  const [error, setError] = useState('');

  // 直接从订阅到的自定义配置合并内置典范，避免依赖读 store 的 getter。
  const profiles = useMemo(() => mergeSubAgentProfiles(subAgentProfiles), [subAgentProfiles]);

  const startCreate = () => {
    setEditingId('new');
    setDraft(emptyDraft());
    setError('');
  };

  const startEdit = (profile: SubAgentProfile) => {
    setEditingId(profile.id);
    setDraft({
      name: profile.name,
      description: profile.description,
      skillId: profile.skillId,
      instructions: profile.instructions ?? '',
      materials: [...profile.materials],
      maxRounds: profile.maxRounds,
    });
    setError('');
  };

  const startDuplicate = (profile: SubAgentProfile) => {
    setEditingId('new');
    setDraft(duplicateProfileAsDraft(profile));
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setError('');
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      if (editingId === 'new') {
        const created = await createSubAgentProfile(draft);
        showToast(`已创建子智能体「${created.name}」`);
      } else if (editingId) {
        await updateSubAgentProfile(editingId, draft);
        showToast('子智能体已更新');
      }
      cancelEdit();
    } catch (saveError) {
      setError(
        saveError instanceof SubAgentProfileError || saveError instanceof Error
          ? saveError.message
          : '保存失败',
      );
    }
  };

  const handleDelete = async (profile: SubAgentProfile) => {
    try {
      await deleteSubAgentProfile(profile.id);
      showToast(`已删除「${profile.name}」`);
      if (editingId === profile.id) cancelEdit();
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    }
  };

  const toggleMaterial = (material: SubAgentMaterial) => {
    if (!draft) return;
    const has = draft.materials.includes(material);
    setDraft({
      ...draft,
      materials: has
        ? draft.materials.filter((item) => item !== material)
        : [...draft.materials, material],
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          {hideHeading
            ? <span />
            : <h3 className="text-sm font-medium text-canvas-text">子智能体</h3>}
          <AnimatedButton
            onClick={startCreate}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-light"
          >
            <Icon icon="mdi:plus" width="14" />
            新建
          </AnimatedButton>
        </div>
        <p className="text-[11px] leading-relaxed text-canvas-text-muted">
          主任务可以并行派出这些只读子智能体做领域分工。它们只能读取你 @ 引用的节点正文和项目短剧资产，
          不能修改画布或生成媒体；产出需要落地时仍由主任务操作并经你确认。
        </p>
      </div>

      <SubAgentProfileList
        profiles={profiles}
        onEdit={startEdit}
        onDuplicate={startDuplicate}
        onDelete={(profile) => void handleDelete(profile)}
      />

      {draft && (
        <div className="space-y-3 rounded-lg border border-brand/30 bg-canvas-card p-3">
          <h4 className="text-xs font-medium text-canvas-text">
            {editingId === 'new' ? '新建子智能体' : '编辑子智能体'}
          </h4>

          <label className="block space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">名称</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={SUB_AGENT_LIMITS.nameChars}
              placeholder="例如：台词润色师"
              className="w-full rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-xs text-canvas-text"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">
              何时派它（会展示给模型判断）
            </span>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={SUB_AGENT_LIMITS.descriptionChars}
              placeholder="例如：需要把书面台词改得更口语时"
              className="w-full rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-xs text-canvas-text"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">绑定 Skill（可选）</span>
            <select
              value={draft.skillId ?? ''}
              onChange={(e) => setDraft({ ...draft, skillId: e.target.value || undefined })}
              className="w-full rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-xs text-canvas-text"
            >
              <option value="">不绑定，使用下方提示词</option>
              {userSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>{skill.name}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">
              角色提示词（未绑定 Skill 时必填）
            </span>
            <textarea
              value={draft.instructions ?? ''}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              maxLength={SUB_AGENT_LIMITS.instructionsChars}
              rows={5}
              placeholder="描述这个角色的分析框架和输出格式"
              className="w-full resize-y rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-xs text-canvas-text"
            />
          </label>

          <div className="space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">可读材料</span>
            <div className="flex flex-wrap gap-2">
              {SUB_AGENT_MATERIALS.map((material) => (
                <AnimatedButton
                  key={material}
                  onClick={() => toggleMaterial(material)}
                  className={`rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${
                    draft.materials.includes(material)
                      ? 'bg-brand text-white'
                      : 'bg-canvas-hover text-canvas-text-muted'
                  }`}
                >
                  {SUB_AGENT_MATERIAL_LABELS[material]}
                </AnimatedButton>
              ))}
            </div>
            {draft.materials.length === 0 && (
              <p className="text-[10px] text-amber-400">
                至少勾选一项，否则子智能体拿不到任何材料。
              </p>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-canvas-text-secondary">
              最大轮数（{SUB_AGENT_LIMITS.minRounds}–{SUB_AGENT_LIMITS.maxRounds}，越大越贵）
            </span>
            <input
              type="number"
              min={SUB_AGENT_LIMITS.minRounds}
              max={SUB_AGENT_LIMITS.maxRounds}
              value={draft.maxRounds}
              onChange={(e) => setDraft({ ...draft, maxRounds: Number(e.target.value) })}
              className="w-24 rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-xs text-canvas-text"
            />
          </label>

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            <AnimatedButton
              onClick={() => void handleSave()}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-light"
            >
              保存
            </AnimatedButton>
            <AnimatedButton
              onClick={cancelEdit}
              className="rounded-lg px-3 py-1.5 text-xs text-canvas-text-secondary hover:bg-canvas-hover"
            >
              取消
            </AnimatedButton>
          </div>
        </div>
      )}
    </div>
  );
}

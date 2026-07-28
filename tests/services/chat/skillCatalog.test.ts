import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/store/useAppStore';
import {
  buildSkillCatalogPrompt,
  clearSkillCatalogForTests,
  clearSkillCatalogTask,
  consumeSkillContentBudget,
  isSkillModelInvocable,
  listModelInvocableSkills,
  resolveModelInvocableSkill,
  SKILL_CATALOG_LIMITS,
} from '../../../src/services/chat/skillCatalog';
import type { UserSkill } from '../../../src/types';

function skill(partial: Partial<UserSkill> = {}): UserSkill {
  return {
    id: 'skill-1',
    name: 'Canvas audit',
    description: 'Audit the canvas',
    fileName: 'SKILL.md',
    content: 'Review the canvas.',
    sourceType: 'file',
    createdAt: 1,
    ...partial,
  };
}

function setSkills(skills: UserSkill[]): void {
  useAppStore.setState({ userSkills: skills });
}

beforeEach(() => {
  clearSkillCatalogForTests();
  setSkills([]);
});

describe('模型可见性', () => {
  it('默认可被模型调用', () => {
    expect(isSkillModelInvocable(skill())).toBe(true);
  });

  it('disable-model-invocation 的 Skill 对模型完全不存在', () => {
    setSkills([skill({ id: 'hidden', manifest: { disableModelInvocation: true } })]);
    expect(listModelInvocableSkills()).toEqual([]);
    expect(resolveModelInvocableSkill('hidden')).toBeUndefined();
    expect(buildSkillCatalogPrompt()).toBe('');
  });

  it('user-invocable: false 仍然对模型可见（两个开关互相独立）', () => {
    setSkills([skill({ id: 'auto', manifest: { userInvocable: false } })]);
    expect(listModelInvocableSkills().map((item) => item.id)).toEqual(['auto']);
    expect(resolveModelInvocableSkill('auto')?.id).toBe('auto');
  });
});

describe('buildSkillCatalogPrompt', () => {
  it('目录为空时不产生空标题', () => {
    expect(buildSkillCatalogPrompt()).toBe('');
  });

  it('优先使用 when-to-use，并带不可信边界说明', () => {
    setSkills([skill({
      manifest: { whenToUse: '发布工作流之前使用', description: '不该被选中的描述' },
    })]);
    const prompt = buildSkillCatalogPrompt();
    expect(prompt).toContain('不可信');
    expect(prompt).toContain('skillId: skill-1');
    expect(prompt).toContain('发布工作流之前使用');
    expect(prompt).not.toContain('不该被选中的描述');
  });

  it('把换行、制表符和控制字符折叠为单行纯文本', () => {
    setSkills([skill({
      name: 'Canvas\naudit',
      description: '第一行\n\t第二行\u0007第三行',
      manifest: undefined,
    })]);
    const prompt = buildSkillCatalogPrompt();
    const entry = prompt.split('\n').find((line) => line.includes('skillId: skill-1'));
    expect(entry).toBeDefined();
    expect(entry).toContain('Canvas audit');
    expect(entry).toContain('第一行 第二行 第三行');
    expect(entry).not.toContain('\u0007');
  });

  it('截断超长用途文本', () => {
    setSkills([skill({ description: 'a'.repeat(400), manifest: undefined })]);
    const prompt = buildSkillCatalogPrompt();
    expect(prompt).not.toContain('a'.repeat(SKILL_CATALOG_LIMITS.indexPurposeChars + 1));
  });

  it('按条目数上限保留最新上传的 Skill', () => {
    const total = SKILL_CATALOG_LIMITS.maxIndexEntries + 5;
    setSkills(Array.from({ length: total }, (_, index) => skill({
      id: `skill-${index}`,
      name: `Skill ${index}`,
      description: 'desc',
      createdAt: index,
      manifest: undefined,
    })));
    const prompt = buildSkillCatalogPrompt();
    const entries = prompt.split('\n').filter((line) => line.startsWith('- '));
    expect(entries).toHaveLength(SKILL_CATALOG_LIMITS.maxIndexEntries);
    expect(prompt).toContain(`skillId: skill-${total - 1}`);
    expect(prompt).not.toContain('skillId: skill-0）');
  });

  it('受 token 预算约束', () => {
    setSkills(Array.from({ length: SKILL_CATALOG_LIMITS.maxIndexEntries }, (_, index) => skill({
      id: `skill-${index}`,
      name: `技能名称占位${index}`,
      description: '用途说明'.repeat(20),
      createdAt: index,
      manifest: undefined,
    })));
    const entries = buildSkillCatalogPrompt().split('\n').filter((line) => line.startsWith('- '));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(SKILL_CATALOG_LIMITS.maxIndexEntries);
  });
});

describe('任务级加载预算', () => {
  it('允许在配额内加载并累计字符', () => {
    const first = consumeSkillContentBudget('task-1', 'skill-1', 100);
    expect(first).toEqual({ ok: true, allowedChars: 100 });
    expect(consumeSkillContentBudget('task-1', 'skill-1', 50))
      .toEqual({ ok: true, allowedChars: 50 });
  });

  it('同一 Skill 的重复读取不额外占用 Skill 数量配额', () => {
    for (let index = 0; index < SKILL_CATALOG_LIMITS.maxTaskSkillLoads + 3; index += 1) {
      expect(consumeSkillContentBudget('task-1', 'skill-1', 10).ok).toBe(true);
    }
  });

  it('超过 Skill 数量上限后返回中文拒绝原因而不是抛错', () => {
    for (let index = 0; index < SKILL_CATALOG_LIMITS.maxTaskSkillLoads; index += 1) {
      expect(consumeSkillContentBudget('task-1', `skill-${index}`, 10).ok).toBe(true);
    }
    const result = consumeSkillContentBudget('task-1', 'skill-extra', 10);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('数量');
  });

  it('字符预算耗尽后拒绝，并按剩余额度收窄', () => {
    const nearlyAll = SKILL_CATALOG_LIMITS.taskContentChars - 200;
    expect(consumeSkillContentBudget('task-1', 'skill-1', nearlyAll))
      .toEqual({ ok: true, allowedChars: nearlyAll });
    const result = consumeSkillContentBudget('task-1', 'skill-1', 1000);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('预算');
  });

  it('按剩余额度收窄单次返回长度', () => {
    const used = SKILL_CATALOG_LIMITS.taskContentChars - 3000;
    consumeSkillContentBudget('task-1', 'skill-1', used);
    expect(consumeSkillContentBudget('task-1', 'skill-1', 99999))
      .toEqual({ ok: true, allowedChars: 3000 });
  });

  it('任务之间预算互相隔离，清理后重置', () => {
    consumeSkillContentBudget('task-1', 'skill-1', SKILL_CATALOG_LIMITS.taskContentChars);
    expect(consumeSkillContentBudget('task-2', 'skill-1', 100).ok).toBe(true);
    clearSkillCatalogTask('task-1');
    expect(consumeSkillContentBudget('task-1', 'skill-1', 100).ok).toBe(true);
  });
});

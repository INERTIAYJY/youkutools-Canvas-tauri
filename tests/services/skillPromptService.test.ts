import { describe, expect, it } from 'vitest';
import {
  expandSkillReferences,
  SKILL_CONTENT_LIMITS,
  truncateSkillContent,
} from '../../src/services/skillPromptService';
import type { UserSkill } from '../../src/types';

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

function body(char: string, length: number): string {
  return char.repeat(length);
}

describe('truncateSkillContent', () => {
  it('keeps content untouched below the limit', () => {
    const result = truncateSkillContent('short body', 100);
    expect(result).toEqual({ content: 'short body', truncated: false });
  });

  it('cuts to the limit and appends a Chinese truncation notice', () => {
    const result = truncateSkillContent(body('a', 30), 10);
    expect(result.truncated).toBe(true);
    expect(result.content.startsWith(body('a', 10))).toBe(true);
    expect(result.content).toContain('已截断');
    expect(result.content).not.toContain(body('a', 11));
  });

  it('keeps only the notice when the limit is zero', () => {
    const result = truncateSkillContent(body('a', 30), 0);
    expect(result.truncated).toBe(true);
    expect(result.content).not.toContain('a');
    expect(result.content).toContain('已截断');
  });
});

describe('expandSkillReferences budget', () => {
  it('leaves short expansions byte-identical to the raw skill body', () => {
    const skills = [skill({ content: '# Audit\n\nReview every node.' })];
    expect(expandSkillReferences('@skill{skill-1|Canvas audit}', skills))
      .toBe('# Audit\n\nReview every node.');
  });

  it('truncates a single oversized skill body', () => {
    const oversized = body('a', SKILL_CONTENT_LIMITS.singleSkillChars + 500);
    const expanded = expandSkillReferences(
      '@skill{skill-1|Canvas audit}',
      [skill({ content: oversized })],
    );
    expect(expanded).toContain('已截断');
    expect(expanded.length).toBeLessThan(oversized.length);
    expect(expanded).not.toContain(body('a', SKILL_CONTENT_LIMITS.singleSkillChars + 1));
  });

  it('truncates later skills instead of dropping them once the total budget runs out', () => {
    const skills = [
      skill({ id: 'skill-1', content: body('a', SKILL_CONTENT_LIMITS.singleSkillChars) }),
      skill({ id: 'skill-2', content: body('b', SKILL_CONTENT_LIMITS.singleSkillChars) }),
      skill({ id: 'skill-3', content: body('c', SKILL_CONTENT_LIMITS.singleSkillChars) }),
    ];
    const expanded = expandSkillReferences(
      '@skill{skill-1|A}@skill{skill-2|B}@skill{skill-3|C}',
      skills,
    );

    expect(expanded).toContain('aaa');
    expect(expanded).toContain('bbb');
    // 第三个 Skill 仍然出现，只是内容被截断为提示行。
    expect(expanded).not.toContain('ccc');
    expect(expanded.split('已截断').length - 1).toBeGreaterThanOrEqual(1);
    expect(expanded.length).toBeLessThanOrEqual(
      SKILL_CONTENT_LIMITS.expansionTotalChars + 500,
    );
  });

  it('still substitutes the template placeholder after truncation', () => {
    const oversized = `${body('a', SKILL_CONTENT_LIMITS.singleSkillChars + 100)}{{ 文章内容 }}`;
    const expanded = expandSkillReferences(
      '总结这段话 @skill{skill-1|Canvas audit}',
      [skill({ content: oversized })],
    );
    // 占位符本身被截掉时，用户输入必须回退为前缀，不能整体丢失。
    expect(expanded).toContain('总结这段话');
    expect(expanded).toContain('已截断');
  });

  it('keeps the placeholder substitution when the body fits', () => {
    const expanded = expandSkillReferences(
      '总结这段话 @skill{skill-1|Canvas audit}',
      [skill({ content: '规则：\n{{ 文章内容 }}\n输出摘要。' })],
    );
    expect(expanded).toBe('规则：\n总结这段话\n输出摘要。');
  });
});

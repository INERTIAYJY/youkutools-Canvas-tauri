import { describe, expect, it } from 'vitest';
import {
  buildAnimationReskinPrompt,
  buildAnimationSpritePrompt,
} from '../../src/services/ai/animationPrompt';

describe('buildAnimationReskinPrompt', () => {
  const sheet = '@{node-1:待机}';
  const skins = ['@{node-2:新角色}', '@{node-3:背面}'];

  it('把原 sheet 标成姿势来源、连入图标成外观来源', () => {
    const prompt = buildAnimationReskinPrompt(sheet, skins);
    expect(prompt).toContain(`${sheet} 是原动作 Sprite Sheet 宫格图，只提供姿势与骨骼`);
    expect(prompt).toContain('@{node-2:新角色}、@{node-3:背面} 是新角色形象图，只提供外观');
    expect(prompt).toMatch(/逐格严格复制/);
  });

  it('交给 sprite 提示词后仍带上宫格与骨骼约束', () => {
    const full = buildAnimationSpritePrompt(
      buildAnimationReskinPrompt(sheet, skins),
      'walk',
      8,
      '2:1',
    );
    expect(full).toContain(sheet);
    expect(full).toContain('4 列 × 2 行');
    expect(full).toContain('【骨骼连续性】');
  });
});

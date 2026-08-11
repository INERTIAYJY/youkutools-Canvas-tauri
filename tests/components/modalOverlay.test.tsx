import { describe, expect, it } from 'vitest';
import { panelMotion } from '../../src/utils/motion';

const cases = [true, false].flatMap((reduceMotion) => (
  [true, false].flatMap((quick) => (
    [true, false].map((draggable) => ({ reduceMotion, quick, draggable }))
  ))
));

describe('ModalOverlay 面板动画', () => {
  it.each(cases)('initial 里的属性都会被 animate 写回 (%o)', ({ reduceMotion, quick, draggable }) => {
    const { initial, animate } = panelMotion(reduceMotion, quick, draggable);
    // 漏写一个属性就会停在初始值：面板 opacity 0，看不见但仍可点击
    expect(Object.keys(animate).sort()).toEqual(Object.keys(initial).sort());
  });
});

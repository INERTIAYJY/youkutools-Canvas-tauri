import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Select Portal 点击边界', () => {
  it('项目设置把 fixedMenu 的 Portal 菜单视为弹层内交互', () => {
    const selectSource = readFileSync(
      new URL('../../src/components/shared/Select.tsx', import.meta.url),
      'utf8',
    );
    const projectSettingsSource = readFileSync(
      new URL('../../src/components/ProjectSettingsPopover.tsx', import.meta.url),
      'utf8',
    );

    expect(selectSource).toContain("data-ui-select-portal={fixedMenu ? '' : undefined}");
    expect(projectSettingsSource).toContain("closest('[data-ui-select-portal]')");
  });

  it('节点弹窗和图层编辑器保留下拉菜单的键盘边界', () => {
    const dialog = readFileSync(new URL('../../src/components/nodes/AINodeDialog.tsx', import.meta.url), 'utf8');
    const composer = readFileSync(new URL('../../src/components/nodes/shared/image/composer/ImageComposerEditor.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain("if (document.querySelector('[data-ui-select-portal]')) return;");
    expect(composer).toContain("closest('.ui-select, [data-ui-select-portal]')");
  });
});

/**
 * freeDistributionNoticeDialog — 回归测试：免费发行提醒。
 */
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n', () => ({
  useT: () => (text: string) => text,
}));

import FreeDistributionNoticeDialog from '../../src/components/FreeDistributionNoticeDialog';
import ModalOverlay from '../../src/components/shared/ModalOverlay';

function elements(root: unknown): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...elements(root.props.children)];
}

function textContent(root: unknown): string {
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  if (Array.isArray(root)) return root.map(textContent).join(' ');
  if (!isValidElement<Record<string, unknown>>(root)) return '';
  return textContent(root.props.children);
}

describe('免费发行提醒', () => {
  it('明确免费与维权信息，并且只能通过确认关闭', () => {
    const onAcknowledge = vi.fn();
    const dialog = FreeDistributionNoticeDialog({ onAcknowledge });

    expect(dialog.type).toBe(ModalOverlay);
    expect(dialog.props).toMatchObject({
      closeOnBackdrop: false,
      onClose: onAcknowledge,
      ariaLabel: 'AI Canvas 免费发行提醒',
    });

    const content = textContent(dialog);
    expect(content).toContain('AI Canvas 完全免费');
    expect(content).toContain('XiaoA250908');
    expect(content).toContain('投诉举报、申请退款');
    expect(content).toContain('模型 API、云端算力等第三方服务可能自行收费');

    const confirmButton = elements(dialog).find((element) => (
      element.type === 'button' && textContent(element).includes('我知道了，继续使用')
    ));
    expect(confirmButton?.props).toMatchObject({ autoFocus: true, onClick: onAcknowledge });
    (confirmButton?.props.onClick as () => void)();
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });
});

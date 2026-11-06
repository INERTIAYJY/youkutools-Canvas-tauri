/**
 * 免费发行提醒 — 新安装与升级用户各确认一次，避免第三方冒充官方收费转售。
 */
import { Icon } from '@iconify/react';
import { useT } from '../i18n';
import ModalOverlay from './shared/ModalOverlay';

interface FreeDistributionNoticeDialogProps {
  onAcknowledge: () => void;
}

export default function FreeDistributionNoticeDialog({
  onAcknowledge,
}: FreeDistributionNoticeDialogProps) {
  const t = useT();

  return (
    <ModalOverlay
      isOpen
      onClose={onAcknowledge}
      closeOnBackdrop={false}
      ariaLabel={t('AI Canvas 免费发行提醒')}
      className="w-[min(520px,calc(100vw-24px))]"
    >
      <header className="flex items-start gap-3 border-b border-canvas-border px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-bg)] text-[var(--warning-light)]">
          <Icon icon="mdi:shield-alert-outline" width="22" height="22" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <span className="ui-badge ui-badge--warning mb-1.5">{t('重要提醒')}</span>
          <h2 className="text-base font-semibold text-canvas-text">
            {t('AI Canvas 完全免费')}
          </h2>
          <p className="mt-1 text-xs leading-5 text-canvas-text-secondary">
            {t('请勿为软件、入群资格或使用授权向第三方付款')}
          </p>
        </div>
      </header>

      <div className="space-y-3 px-5 py-4 text-sm leading-6 text-canvas-text-secondary">
        <p>
          {t('AI Canvas 本体完全免费，项目方从未授权任何个人或账号收费售卖软件、入群资格或使用授权。')}
        </p>

        <section className="ui-alert ui-alert--warning">
          <Icon
            icon="mdi:alert-circle-outline"
            width="18"
            height="18"
            className="ui-alert__icon"
            aria-hidden="true"
          />
          <div className="ui-alert__body">
            <h3 className="ui-alert__title">{t('如果你已经付费')}</h3>
            <p>
              {t('如果你是通过抖音账号“XiaoA灵洞”（抖音号：XiaoA250908）付费获得本画布，该收费并非本项目官方行为。请立即保存聊天记录、付款凭证等证据，并通过抖音平台投诉举报、申请退款。')}
            </p>
          </div>
        </section>

        <p className="font-medium text-canvas-text">
          {t('请勿继续向任何第三方支付软件费、入群费或授权费。')}
        </p>

        <div className="flex items-start gap-2 rounded-lg bg-canvas-hover/70 px-3 py-2.5 text-xs leading-5 text-canvas-text-muted">
          <Icon
            icon="mdi:information-outline"
            width="16"
            height="16"
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <p>
            {t('说明：模型 API、云端算力等第三方服务可能自行收费，这些费用与画布软件售价无关。')}
          </p>
        </div>
      </div>

      <footer className="flex justify-end border-t border-canvas-border px-5 py-3.5">
        <button
          type="button"
          autoFocus
          onClick={onAcknowledge}
          className="ui-btn ui-btn--primary ui-btn--lg"
        >
          <Icon icon="mdi:check" width="16" height="16" aria-hidden="true" />
          {t('我知道了，继续使用')}
        </button>
      </footer>
    </ModalOverlay>
  );
}

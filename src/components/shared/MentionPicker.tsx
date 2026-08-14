/**
 * MentionPicker — @ 选中器的公用外观：分段 Tab + 筛选芯片 + 图片卡片网格。
 *
 * 纯展示组件：数据来源、过滤和「选中后往编辑器里插什么」都留在调用方
 * （MentionEditor 用于节点提示词，ChatInput 用于聊天）。
 * 卡片走 onMouseDown + preventDefault，避免抢走 contenteditable 的光标。
 */
import { Icon } from '@iconify/react';
import type { ReactNode } from 'react';

export interface MentionPickerTab {
  id: string;
  label: string;
  icon?: string;
}

export interface MentionPickerChip {
  id: string;
  label: string;
  count?: number;
}

export interface MentionPickerItem {
  key: string;
  label: string;
  thumbnailUrl?: string;
  /** 无缩略图时的占位图标（iconify 名） */
  icon?: string;
  /** 缩略图右上角小标，如 #3 / 自身 / 视频 */
  badge?: string;
  disabled?: boolean;
  title?: string;
  /** 供 aria-activedescendant 引用；不需要键盘导航时可省略 */
  domId?: string;
  onSelect: () => void;
}

interface MentionPickerProps {
  tabs: MentionPickerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  chips?: MentionPickerChip[];
  activeChip?: string;
  onChipChange?: (id: string) => void;
  items: MentionPickerItem[];
  /** 键盘高亮项的 key */
  activeKey?: string;
  /** 鼠标移入某项时同步高亮 */
  onItemHover?: (key: string) => void;
  emptyText?: string;
  /** 芯片行左侧插槽（返回按钮等）；无芯片时单独成行 */
  leading?: ReactNode;
  footer?: ReactNode;
  listId?: string;
  ariaLabel?: string;
  className?: string;
}

export default function MentionPicker({
  tabs,
  activeTab,
  onTabChange,
  chips,
  activeChip,
  onChipChange,
  items,
  activeKey,
  onItemHover,
  emptyText = '没有可引用的内容',
  leading,
  footer,
  listId,
  ariaLabel,
  className = '',
}: MentionPickerProps) {
  const hasChipRow = !!leading || (chips?.length ?? 0) > 0;

  return (
    <div className={`mention-picker ${className}`}>
      {tabs.length > 1 && (
        <div className="mention-picker-tabs" role="tablist" aria-label={ariaLabel}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              className={`mention-picker-tab${tab.id === activeTab ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onTabChange(tab.id); }}
            >
              {tab.icon && <Icon icon={tab.icon} width="14" height="14" />}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {hasChipRow && (
        <div className="mention-picker-chips">
          {leading}
          {chips?.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`mention-picker-chip${chip.id === activeChip ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChipChange?.(chip.id); }}
            >
              {chip.label}
              {chip.count != null && <span className="mention-picker-chip-count">{chip.count}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mention-picker-grid" id={listId} role="listbox" aria-label={ariaLabel}>
        {items.length === 0 ? (
          <div className="mention-picker-empty">{emptyText}</div>
        ) : (
          items.map((item) => (
            <button
              key={item.key}
              id={item.domId}
              type="button"
              role="option"
              aria-selected={item.key === activeKey}
              disabled={item.disabled}
              title={item.title ?? item.label}
              className={`mention-picker-card${item.key === activeKey ? ' active' : ''}`}
              onMouseEnter={() => onItemHover?.(item.key)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!item.disabled) item.onSelect();
              }}
            >
              <span className="mention-picker-card-media">
                {/* 图标垫在底层：缩略图加载失败时自己隐藏，露出图标而不是空白卡 */}
                <Icon icon={item.icon || 'mdi:vector-square'} width="26" height="26" />
                {item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                {item.badge && <span className="mention-picker-card-badge">{item.badge}</span>}
              </span>
              <span className="mention-picker-card-name">{item.label}</span>
            </button>
          ))
        )}
      </div>

      {footer && <div className="mention-picker-footer">{footer}</div>}
    </div>
  );
}

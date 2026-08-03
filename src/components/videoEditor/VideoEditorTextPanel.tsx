import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import {
  DEFAULT_TEXT_STYLE,
  type VideoEditorClip,
  type VideoEditorTextAlign,
  type VideoEditorTextStyle,
} from '../../types/videoEditor';
import {
  getSystemFontOptions,
  queryLocalFontOptions,
  type LocalFontOption,
} from '../../services/localFontService';

interface VideoEditorTextPanelProps {
  selectedClip: VideoEditorClip | null;
  onAddText: () => void;
  onPatchText: (patch: Partial<VideoEditorTextStyle>) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
}

const ALIGN_OPTIONS: { value: VideoEditorTextAlign; icon: string; label: string }[] = [
  { value: 'left', icon: 'lucide:align-left', label: '左对齐' },
  { value: 'center', icon: 'lucide:align-center', label: '居中' },
  { value: 'right', icon: 'lucide:align-right', label: '右对齐' },
];

function VideoEditorTextPanel({
  selectedClip,
  onAddText,
  onPatchText,
  onBeginInteraction,
  onEndInteraction,
}: VideoEditorTextPanelProps) {
  const [fontOptions, setFontOptions] = useState<LocalFontOption[]>(getSystemFontOptions);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontMessage, setFontMessage] = useState('');
  const [fontOpen, setFontOpen] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const fontPickerRef = useRef<HTMLDivElement>(null);
  const visibleFontOptions = useMemo(() => {
    const query = fontQuery.trim().toLocaleLowerCase();
    if (!query) return fontOptions;
    return fontOptions.filter((option) => option.label.toLocaleLowerCase().includes(query));
  }, [fontOptions, fontQuery]);

  useEffect(() => {
    if (!fontOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!fontPickerRef.current?.contains(event.target as Node)) setFontOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFontOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fontOpen]);

  const loadLocalFonts = async () => {
    setFontLoading(true);
    setFontMessage('');
    try {
      const options = await queryLocalFontOptions();
      setFontOptions(options);
      setFontOpen(true);
      setFontMessage(`已读取 ${Math.max(0, options.length - getSystemFontOptions().length)} 个本机字体`);
    } catch (error) {
      setFontMessage(error instanceof Error ? error.message : '读取本机字体失败');
    } finally {
      setFontLoading(false);
    }
  };

  const isText = selectedClip?.kind === 'text';
  const style = { ...DEFAULT_TEXT_STYLE, ...selectedClip?.textStyle };
  return (
    <div className="video-editor-layer-panel">
      <button type="button" className="video-editor-layer-add" onClick={onAddText}>
        <Icon icon="lucide:type" width={16} height={16} />
        添加文字
      </button>

      {isText ? (
        <div className="video-editor-layer-controls">
          <label className="video-editor-field-stack">
            <span>文字内容</span>
            <textarea
              value={style.content}
              rows={3}
              maxLength={240}
              onFocus={onBeginInteraction}
              onBlur={onEndInteraction}
              onChange={(event) => onPatchText({ content: event.target.value })}
            />
          </label>

          <div className="video-editor-field-stack">
            <span>字体</span>
            <div ref={fontPickerRef} className="video-editor-font-picker">
              <div className="video-editor-font-select-wrap">
                <button
                  type="button"
                  className="video-editor-font-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={fontOpen}
                  onClick={() => setFontOpen((open) => !open)}
                >
                  <span style={{ fontFamily: style.fontFamily }}>
                    {fontOptions.find((option) => option.value === style.fontFamily)?.label ?? '当前字体'}
                  </span>
                  <Icon icon="lucide:chevron-down" width={14} height={14} />
                </button>
                {fontOpen && (
                  <div className="video-editor-font-menu">
                    <div className="video-editor-font-search">
                      <Icon icon="lucide:search" width={14} height={14} />
                      <input
                        autoFocus
                        value={fontQuery}
                        placeholder="搜索字体"
                        aria-label="搜索字体"
                        onChange={(event) => setFontQuery(event.target.value)}
                      />
                    </div>
                    <div className="video-editor-font-options" role="listbox" aria-label="字体">
                      {visibleFontOptions.map((option) => {
                        const selected = option.value === style.fontFamily;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            key={option.value}
                            className={selected ? 'selected' : ''}
                            style={{ fontFamily: option.value }}
                            onClick={() => {
                              onBeginInteraction();
                              onPatchText({ fontFamily: option.value });
                              onEndInteraction();
                              setFontOpen(false);
                              setFontQuery('');
                            }}
                          >
                            <span>{option.label}</span>
                            {selected && <Icon icon="lucide:check" width={14} height={14} />}
                          </button>
                        );
                      })}
                      {visibleFontOptions.length === 0 && (
                        <span className="video-editor-font-no-result">没有匹配的字体</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="video-editor-font-load"
                disabled={fontLoading}
                onClick={() => void loadLocalFonts()}
              >
                <Icon icon={fontLoading ? 'lucide:loader-circle' : 'lucide:scan-search'} width={14} height={14} />
                {fontLoading ? '读取中' : '本机字体'}
              </button>
            </div>
            {fontMessage && <em className="video-editor-font-message">{fontMessage}</em>}
          </div>

          <label className="video-editor-inspect-slider">
            <span>字号</span>
            <input
              type="range"
              min={16}
              max={180}
              step={1}
              value={style.fontSize}
              style={{ '--range-progress': `${((style.fontSize - 16) / (180 - 16)) * 100}%` } as CSSProperties}
              onPointerDown={onBeginInteraction}
              onPointerUp={onEndInteraction}
              onPointerCancel={onEndInteraction}
              onKeyDown={onBeginInteraction}
              onKeyUp={onEndInteraction}
              onChange={(event) => onPatchText({ fontSize: Number(event.target.value) })}
            />
            <em>{style.fontSize}px</em>
          </label>

          <div className="video-editor-field-row">
            <span>颜色</span>
            <label className="video-editor-color-field">
              <input
                type="color"
                value={style.color}
                aria-label="文字颜色"
                onFocus={onBeginInteraction}
                onBlur={onEndInteraction}
                onChange={(event) => onPatchText({ color: event.target.value })}
              />
              <code>{style.color.toUpperCase()}</code>
            </label>
          </div>

          <div className="video-editor-field-row">
            <span>字重</span>
            <div className="video-editor-segmented">
              {([400, 600, 700] as const).map((weight) => (
                <button
                  type="button"
                  key={weight}
                  className={style.fontWeight === weight ? 'active' : ''}
                  onClick={() => {
                    onBeginInteraction();
                    onPatchText({ fontWeight: weight });
                    onEndInteraction();
                  }}
                >
                  {weight === 400 ? '常规' : weight === 600 ? '中等' : '粗体'}
                </button>
              ))}
            </div>
          </div>

          <div className="video-editor-field-row">
            <span>对齐</span>
            <div className="video-editor-segmented icon-only">
              {ALIGN_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={style.align === option.value ? 'active' : ''}
                  aria-label={option.label}
                  data-tooltip={option.label}
                  onClick={() => {
                    onBeginInteraction();
                    onPatchText({ align: option.value });
                    onEndInteraction();
                  }}
                >
                  <Icon icon={option.icon} width={14} height={14} />
                </button>
              ))}
            </div>
          </div>

          <p className="video-editor-layer-hint">可直接在预览画面拖动、缩放；显示时长在时间轴调整。</p>
        </div>
      ) : (
        <div className="video-editor-layer-empty">
          <Icon icon="lucide:mouse-pointer-2" width={20} height={20} />
          <span>添加或选中一段文字后编辑样式</span>
        </div>
      )}
    </div>
  );
}

export default memo(VideoEditorTextPanel);

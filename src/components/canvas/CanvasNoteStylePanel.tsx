/**
 * canvas/CanvasNoteStylePanel — 画布笔记样式面板。
 * 编辑当前选中笔记笔记（CanvasNote）的描边颜色、线宽、线型、箭头、圆角、字体与层级等样式，
 * 通过 store 的 note patch 动作实时回写并提交历史快照。
 */
import { memo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  BookOpenText,
  CaseUpper,
  Code2,
  Copy,
  CornerDownRight,
  Crop,
  Link2,
  Minus,
  PenLine,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Waves,
} from 'lucide-react';
import type {
  CanvasNoteData,
  CanvasNoteLayerDirection,
  CanvasNotePatch,
  CanvasNoteStyle,
} from '../../types';
import { useT } from '../../i18n';

interface CanvasNoteStylePanelProps {
  note: CanvasNoteData | null;
  selected: boolean;
  onPatch: (patch: CanvasNotePatch) => void;
  onTransientPatch: (patch: CanvasNotePatch) => void;
  onBeginChange: () => void;
  onEndChange: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveLayer: (direction: CanvasNoteLayerDirection) => void;
  onCrop: () => void;
}

const STROKE_COLORS = [
  'var(--theme-text)',
  'var(--danger)',
  'var(--success)',
  'var(--node-video)',
  'var(--accent-amber)',
  'var(--theme-card)',
];
const FILL_COLORS = [
  'transparent',
  'color-mix(in srgb, var(--danger) 32%, transparent)',
  'color-mix(in srgb, var(--success) 32%, transparent)',
  'color-mix(in srgb, var(--node-video) 32%, transparent)',
  'color-mix(in srgb, var(--accent-amber) 32%, transparent)',
  'var(--theme-card)',
];

function PanelSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="canvas-note-panel-section">
      <h3>{label}</h3>
      <div className="canvas-note-panel-options">{children}</div>
    </section>
  );
}

function OptionButton({
  label,
  active,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`canvas-note-option ${active ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ColorSwatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}) {
  const t = useT();
  return colors.map((color) => (
    <button
      key={color}
      type="button"
      className={`canvas-note-swatch ${color === 'transparent' ? 'is-transparent' : ''} ${value === color ? 'is-active' : ''}`}
      style={{ '--note-swatch': color === 'transparent' ? 'var(--theme-surface)' : color } as CSSProperties}
      aria-label={color === 'transparent' ? t('透明') : color}
      aria-pressed={value === color}
      onClick={() => onChange(color)}
    />
  ));
}

function CanvasNoteStylePanel({
  note,
  selected,
  onPatch,
  onTransientPatch,
  onBeginChange,
  onEndChange,
  onDuplicate,
  onDelete,
  onMoveLayer,
  onCrop,
}: CanvasNoteStylePanelProps) {
  const t = useT();
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkDraft, setLinkDraft] = useState(note?.link ?? '');
  if (!note) return null;

  const patchStyle = (patch: Partial<CanvasNoteStyle>) => onPatch({ style: patch });
  const isShape = note.kind === 'rectangle' || note.kind === 'diamond' || note.kind === 'ellipse';
  const isLinear = note.kind === 'arrow' || note.kind === 'line';
  const hasStroke = note.kind !== 'image';
  const hasFill = isShape;
  const hasStrokeWidth = isShape || isLinear || note.kind === 'freehand';
  const hasStrokeStyle = isShape || isLinear;
  const hasRoughness = isShape || isLinear;
  const hasRoundness = note.kind === 'rectangle' || note.kind === 'image';

  return (
    <aside className="canvas-note-style-panel canvas-drawing-ui" aria-label={t('画布笔记属性')}>
      {hasStroke && (
        <PanelSection label={t('描边')}>
          <ColorSwatches colors={STROKE_COLORS} value={note.style.strokeColor} onChange={(strokeColor) => patchStyle({ strokeColor })} />
        </PanelSection>
      )}

      {hasFill && (
        <PanelSection label={t('填充')}>
          <ColorSwatches colors={FILL_COLORS} value={note.style.backgroundColor} onChange={(backgroundColor) => patchStyle({ backgroundColor })} />
        </PanelSection>
      )}

      {hasStrokeWidth && (
        <PanelSection label={t('描边宽度')}>
          {([1, 2, 4] as const).map((strokeWidth) => (
            <OptionButton key={strokeWidth} label={t('{count} 像素', { count: strokeWidth })} active={note.style.strokeWidth === strokeWidth} onClick={() => patchStyle({ strokeWidth })}>
              <span className="canvas-note-stroke-preview" style={{ height: strokeWidth }} />
            </OptionButton>
          ))}
        </PanelSection>
      )}

      {hasStrokeStyle && (
        <PanelSection label={t('边框样式')}>
          {(['solid', 'dashed', 'dotted'] as const).map((strokeStyle) => (
            <OptionButton key={strokeStyle} label={strokeStyle} active={note.style.strokeStyle === strokeStyle} onClick={() => patchStyle({ strokeStyle })}>
              <span className={`canvas-note-line-preview is-${strokeStyle}`} />
            </OptionButton>
          ))}
        </PanelSection>
      )}

      {hasRoughness && (
        <PanelSection label={t('线条风格')}>
          <OptionButton label={t('精确')} active={note.style.roughness === 'architect'} onClick={() => patchStyle({ roughness: 'architect' })}><Minus size={20} /></OptionButton>
          <OptionButton label={t('手绘')} active={note.style.roughness === 'artist'} onClick={() => patchStyle({ roughness: 'artist' })}><Spline size={20} /></OptionButton>
          <OptionButton label={t('粗略')} active={note.style.roughness === 'cartoonist'} onClick={() => patchStyle({ roughness: 'cartoonist' })}><Waves size={20} /></OptionButton>
        </PanelSection>
      )}

      {isLinear && (
        <>
          <PanelSection label={t('线条类型')}>
            <OptionButton label={t('直线')} active={note.style.lineType === 'straight'} onClick={() => patchStyle({ lineType: 'straight' })}><ArrowRight size={20} /></OptionButton>
            <OptionButton label={t('曲线')} active={note.style.lineType === 'curved'} onClick={() => patchStyle({ lineType: 'curved' })}><Spline size={20} /></OptionButton>
            <OptionButton label={t('折线')} active={note.style.lineType === 'elbow'} onClick={() => patchStyle({ lineType: 'elbow' })}><CornerDownRight size={20} /></OptionButton>
          </PanelSection>
          <PanelSection label={t('端点')}>
            <OptionButton label={t('起点无箭头')} active={note.style.startArrowhead === 'none'} onClick={() => patchStyle({ startArrowhead: 'none' })}><Minus size={20} /></OptionButton>
            <OptionButton label={t('起点箭头')} active={note.style.startArrowhead === 'arrow'} onClick={() => patchStyle({ startArrowhead: 'arrow' })}><ArrowRight size={20} className="rotate-180" /></OptionButton>
            <OptionButton label={t('终点无箭头')} active={note.style.endArrowhead === 'none'} onClick={() => patchStyle({ endArrowhead: 'none' })}><Minus size={20} /></OptionButton>
            <OptionButton label={t('终点箭头')} active={note.style.endArrowhead === 'arrow'} onClick={() => patchStyle({ endArrowhead: 'arrow' })}><ArrowRight size={20} /></OptionButton>
          </PanelSection>
        </>
      )}

      {note.kind === 'freehand' && (
        <PanelSection label={t('压感')}>
          <OptionButton label={t('均匀线条')} active={!note.style.pressure} onClick={() => patchStyle({ pressure: false })}><Minus size={20} /></OptionButton>
          <OptionButton label={t('模拟压感')} active={note.style.pressure} onClick={() => patchStyle({ pressure: true })}><Waves size={20} /></OptionButton>
        </PanelSection>
      )}

      {hasRoundness && (
        <PanelSection label={t('圆角')}>
          <OptionButton label={t('直角')} active={note.style.roundness === 'sharp'} onClick={() => patchStyle({ roundness: 'sharp' })}><Square size={20} /></OptionButton>
          <OptionButton label={t('圆角')} active={note.style.roundness === 'round'} onClick={() => patchStyle({ roundness: 'round' })}><SquareDashed size={20} /></OptionButton>
        </PanelSection>
      )}

      {note.kind === 'text' && (
        <>
          <PanelSection label={t('字体')}>
            <OptionButton label={t('手写')} active={note.style.fontFamily === 'hand'} onClick={() => patchStyle({ fontFamily: 'hand' })}><PenLine size={20} /></OptionButton>
            <OptionButton label={t('无衬线')} active={note.style.fontFamily === 'sans'} onClick={() => patchStyle({ fontFamily: 'sans' })}><CaseUpper size={20} /></OptionButton>
            <OptionButton label={t('等宽')} active={note.style.fontFamily === 'mono'} onClick={() => patchStyle({ fontFamily: 'mono' })}><Code2 size={20} /></OptionButton>
            <OptionButton label={t('衬线')} active={note.style.fontFamily === 'serif'} onClick={() => patchStyle({ fontFamily: 'serif' })}><BookOpenText size={20} /></OptionButton>
          </PanelSection>
          <PanelSection label={t('字体大小')}>
            {([16, 20, 28, 36] as const).map((fontSize, index) => (
              <OptionButton key={fontSize} label={t('{count} 像素', { count: fontSize })} active={note.style.fontSize === fontSize} onClick={() => patchStyle({ fontSize })}>
                <span className="canvas-note-size-label">{['S', 'M', 'L', 'XL'][index]}</span>
              </OptionButton>
            ))}
          </PanelSection>
          <PanelSection label={t('文本对齐')}>
            <OptionButton label={t('左对齐')} active={note.style.textAlign === 'left'} onClick={() => patchStyle({ textAlign: 'left' })}><AlignLeft size={20} /></OptionButton>
            <OptionButton label={t('居中')} active={note.style.textAlign === 'center'} onClick={() => patchStyle({ textAlign: 'center' })}><AlignCenter size={20} /></OptionButton>
            <OptionButton label={t('右对齐')} active={note.style.textAlign === 'right'} onClick={() => patchStyle({ textAlign: 'right' })}><AlignRight size={20} /></OptionButton>
          </PanelSection>
        </>
      )}

      <PanelSection label={t('透明度')}>
        <div className="canvas-note-opacity-row">
          <input
            type="range"
            min="0"
            max="100"
            value={note.style.opacity}
            onPointerDown={onBeginChange}
            onPointerUp={onEndChange}
            onChange={(event) => onTransientPatch({ style: { opacity: Number(event.target.value) } })}
            aria-label={t('透明度')}
            aria-valuetext={`${note.style.opacity}%`}
          />
          <span>{note.style.opacity}%</span>
        </div>
      </PanelSection>

      {selected && (
        <>
          <PanelSection label={t('图层')}>
            <OptionButton label={t('置于底层')} onClick={() => onMoveLayer('back')}><ArrowDownToLine size={20} /></OptionButton>
            <OptionButton label={t('下移一层')} onClick={() => onMoveLayer('backward')}><ArrowDown size={20} /></OptionButton>
            <OptionButton label={t('上移一层')} onClick={() => onMoveLayer('forward')}><ArrowUp size={20} /></OptionButton>
            <OptionButton label={t('置于顶层')} onClick={() => onMoveLayer('front')}><ArrowUpToLine size={20} /></OptionButton>
          </PanelSection>
          <PanelSection label={t('操作')}>
            <OptionButton label={t('复制')} onClick={onDuplicate}><Copy size={20} /></OptionButton>
            <OptionButton label={t('删除')} onClick={onDelete}><Trash2 size={20} /></OptionButton>
            <OptionButton
              label={t('链接')}
              active={Boolean(note.link)}
              onClick={() => {
                setLinkDraft(note.link ?? '');
                setLinkEditing((value) => !value);
              }}
            >
              <Link2 size={20} />
            </OptionButton>
            {note.kind === 'image' && <OptionButton label={t('裁剪')} onClick={onCrop}><Crop size={20} /></OptionButton>}
          </PanelSection>
          {linkEditing && (
            <form
              className="canvas-note-link-form"
              onSubmit={(event) => {
                event.preventDefault();
                onPatch({ link: linkDraft.trim() || undefined });
                setLinkEditing(false);
              }}
            >
              <input
                type="url"
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                placeholder="https://"
                aria-label={t('笔记链接')}
                autoFocus
              />
              <button type="submit">{t('应用')}</button>
            </form>
          )}
        </>
      )}
    </aside>
  );
}

export default memo(CanvasNoteStylePanel);

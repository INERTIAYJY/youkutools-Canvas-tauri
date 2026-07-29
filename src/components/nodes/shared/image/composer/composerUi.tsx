/**
 * composerUi — 合成器属性面板里复用的表单控件
 *
 * 抽出来是为了让所有滑杆/数值框走同一套排版：标签、控件、数值各占固定列，
 * 于是不同字数的标签（亮度 / 对比度）也能让轨道左右端严格对齐。
 */
import { useState } from 'react';
import { rangeFill } from './composerRange';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 数值列的展示文本，默认显示原始值 */
  display?: string;
  onChange: (v: number) => void;
}

/** 标签 + 滑杆 + 数值 */
export function RangeField({ label, value, min, max, step = 1, display, onChange }: RangeFieldProps) {
  return (
    <label className="composer-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={rangeFill(value, min, max)}
        onChange={(e) => onChange(+e.target.value)}
      />
      <em className="composer-field-value">{display ?? Math.round(value * 100) / 100}</em>
    </label>
  );
}

interface NumFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (v: number) => void;
}

/** 数值输入 — 失焦/回车才提交，避免输入中途被四舍五入打断 */
export function NumField({ label, value, min, max, step = 1, onCommit }: NumFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n)) onCommit(n);
  };
  return (
    <label className="composer-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

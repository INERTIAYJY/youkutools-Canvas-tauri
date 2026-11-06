/**
 * QwenSpeechControls — 提供Qwen 语音参数界面与交互。
 */
import { useId } from 'react';
import type { AudioSpeechParameterValue, AudioSpeechSettings, QwenSpeechControls as Controls, QwenSpeechField } from '../../../types/aiTypes';
import { QWEN_VOICE_PRESETS, qwenFieldValue } from '../../../services/ai/qwenSpeechSettings';
import Select from '../../shared/Select';
import { useT } from '../../../i18n';

interface Props {
  controls: Controls;
  settings?: AudioSpeechSettings;
  onChange?: (value: AudioSpeechSettings) => void;
  onEditEnd?: () => void;
}

export default function QwenSpeechControls({ controls, settings, onChange, onEditEnd }: Props) {
  const t = useT();
  const labelPrefix = useId();
  const value = (field: QwenSpeechField) => qwenFieldValue(controls, field, settings);
  const update = (id: string, next: AudioSpeechParameterValue) => onChange?.({
    ...settings, qwen: { ...settings?.qwen, [controls.workflowId]: { ...settings?.qwen?.[controls.workflowId], [id]: next } },
  });
  const reset = () => {
    const qwen = { ...settings?.qwen };
    delete qwen[controls.workflowId];
    onChange?.({ ...settings, qwen }); onEditEnd?.();
  };
  const labels: Record<string, string> = { fixed: '固定种子', randomize: '每次抽卡', Auto: '自动', auto: '自动',
    Chinese: '中文', English: '英语', Cantonese: '粤语', Japanese: '日语', Korean: '韩语', French: '法语',
    German: '德语', Spanish: '西班牙语', Portuguese: '葡萄牙语', Russian: '俄语', Italian: '意大利语' };
  const renderField = (field: QwenSpeechField) => {
    const current = value(field);
    if (field.key === 'seed') {
      const mode = controls.fields.find((item) => item.nodeId === field.nodeId && item.key === 'seed_mode');
      if (mode && value(mode) === 'randomize') return null;
    }
    const control = field.kind === 'select' ? (
      <Select className="w-full" aria-describedby={`${labelPrefix}-${field.id}`} value={String(current)} onChange={(next) => { update(field.id, next); onEditEnd?.(); }}
        options={field.options?.map((option) => ({ value: option, label: t(labels[option] ?? option) }))} />
    ) : field.kind === 'boolean' ? (
      <button type="button" role="switch" className="ui-switch" aria-label={t(field.label)} aria-checked={current === true}
        onClick={() => { update(field.id, current !== true); onEditEnd?.(); }} />
    ) : field.kind === 'text' ? (
      <textarea aria-label={t(field.label)} className="ui-textarea w-full" rows={3} value={String(current)}
        onChange={(event) => update(field.id, event.target.value)} onBlur={onEditEnd} />
    ) : field.key === 'pace' ? (
      <div className="flex flex-col gap-1">
        <input aria-label={t(field.label)} type="range" className="rh-duration-input w-full" min={0} max={4} step={1} value={Number(current)}
          onChange={(event) => update(field.id, Number(event.target.value))} onPointerUp={onEditEnd} onKeyUp={onEditEnd} onBlur={onEditEnd} />
        <span className="flex justify-between text-canvas-text-secondary"><span>{t('慢')}</span>
          <span>{t(['很慢', '偏慢', '正常', '偏快', '很快'][Number(current)] ?? '正常')}</span><span>{t('快')}</span></span>
      </div>
    ) : (
      <input aria-label={t(field.label)} type="number" className="ui-input ui-input--sm w-full" min={field.min} max={field.max} step={field.step ?? 'any'}
        value={Number(current)} onChange={(event) => { if (event.target.value) update(field.id, Number(event.target.value)); }} onBlur={onEditEnd} />
    );
    return (
      <label key={field.id} className="flex min-w-0 flex-col gap-1.5" data-speech-field={field.id}>
        <span id={`${labelPrefix}-${field.id}`} className="text-canvas-text-secondary">{t(field.label)}</span>{control}
        {field.hint ? <span className="text-[10px] leading-4 text-canvas-text-muted">{t(field.hint)}</span> : null}
      </label>
    );
  };
  const groups = [...new Set(controls.fields.map((field) => field.group))];
  const description = controls.fields.find((field) => field.id === 'design.instruct');
  return (
    <div className="flex flex-col gap-3" data-qwen-speech-mode={controls.mode}>
      {description ? <div className="flex flex-col gap-2">
        <span className="text-canvas-text-secondary">{t(controls.mode === 'reference-design' ? '目标声音类型' : '声音类型')}</span>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('声音类型')}>
          {QWEN_VOICE_PRESETS.map((preset) => <button key={preset.label} type="button"
            className={`ui-btn ui-btn--sm ${value(description) === preset.description ? 'is-active' : ''}`}
            aria-pressed={value(description) === preset.description}
            onClick={() => { update(description.id, preset.description); onEditEnd?.(); }}>{t(preset.label)}</button>)}
        </div>
        {renderField(description)}
      </div> : <p className="text-canvas-text-secondary">{t('沿用参考音色，新的台词填写在主提示词中。')}</p>}
      {groups.map((group) => {
        const fields = controls.fields.filter((field) => field.group === group && field !== description);
        const content = <div className="flex flex-col gap-3 pt-2">{fields.map(renderField)}</div>;
        return ['声音设计', '语音合成'].includes(group) ? (
          <section key={group} aria-label={t(group)}>
            {controls.mode === 'reference-design' ? <p className="font-medium text-canvas-text">{t(group === '语音合成' ? '参考语音克隆' : '目标音色合成')}</p> : null}
            {content}
          </section>
        ) : (
          <details key={group} className="ui-card p-2.5">
            <summary className="cursor-pointer text-canvas-text-secondary">{t(group)}</summary>{content}
            {group === '音色转换（SeedVC）' ? <p className="mt-2 text-[10px] text-canvas-text-muted">{t('长度倍率越大，输出通常越长；具体范围由目标节点校验。')}</p> : null}
          </details>
        );
      })}
      <p className="text-[10px] leading-4 text-canvas-text-muted">{t('生成长度上限以 token 计，不是秒数；过低可能截断长台词。')}</p>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={reset}>{t('恢复此工作流默认参数')}</button>
    </div>
  );
}

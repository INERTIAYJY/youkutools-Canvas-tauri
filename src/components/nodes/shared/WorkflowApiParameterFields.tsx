import type { DeclarativeWorkflowApiManifest } from '../../../types/workflowApi';
import { useT } from '../../../i18n';
import Select from '../../shared/Select';

export default function WorkflowApiParameterFields({ manifest, values = {}, onChange, disabled }: {
  manifest: DeclarativeWorkflowApiManifest; values?: Record<string, string>; onChange: (values: Record<string, string>) => void; disabled?: boolean;
}) {
  const t = useT();
  const currentValue = (name: string) => values[`workflow::${name}`] ?? values[name] ?? '';
  const change = (name: string, value: string) => {
    const next = { ...values }; delete next[name]; delete next[`workflow::${name}`];
    if (value !== '') next[`workflow::${name}`] = value;
    onChange(next);
  };
  return <div className="flex flex-col gap-2">
    <p className="text-xs text-canvas-text-secondary">{(['image', 'video', 'audio'] as const).map((kind) => {
      const limit = manifest.references[kind] ?? { min: 0, max: 0 };
      return `${t(kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频')} ${limit.min}–${limit.max}`;
    }).join(' · ')}</p>
    {Object.entries(manifest.parameters).map(([name, spec]) => <label key={name} className="flex flex-wrap items-center gap-2 text-xs">
      <span>{spec.label || name}{spec.required ? ' *' : ''}</span>
      {spec.type === 'boolean' || spec.options ? <Select className="min-w-0 flex-1" fixedMenu aria-label={spec.label || name}
        disabled={disabled} value={currentValue(name)} onChange={(value) => change(name, value)}
        options={[
          { value: '', label: spec.default === undefined ? t('未填写') : `${t('默认值')}：${spec.default}` },
          ...(spec.type === 'boolean' ? ['true', 'false'] : spec.options ?? []).map((value) => ({ value: String(value), label: String(value) })),
        ]} /> : <input className="ui-input min-w-0 flex-1" disabled={disabled} type={spec.type === 'string' ? 'text' : 'number'}
        step={spec.type === 'integer' ? 1 : 'any'} min={spec.min} max={spec.max} value={currentValue(name)}
        placeholder={spec.default === undefined ? t('未填写') : String(spec.default)} onChange={(event) => change(name, event.target.value)} />}
    </label>)}
  </div>;
}

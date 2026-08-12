import { useState } from 'react';
import { Icon } from '@iconify/react';
import type {
  AgentToolDisplaySnapshot,
  AgentToolDisplayValue,
} from '../../types/agent';
import { useAppStore } from '../../store/useAppStore';

interface AgentToolDetailsProps {
  input?: AgentToolDisplaySnapshot;
  result?: AgentToolDisplaySnapshot;
  defaultExpanded?: boolean;
}

const SOURCE_LABELS = {
  user: '用户指定',
  project_default: '项目默认',
  model_default: '模型默认',
  resolved: '有效值',
} as const;

function formatValue(value: AgentToolDisplayValue | undefined): string {
  if (value === undefined || value === '') return '未设置';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function hasDisplay(display: AgentToolDisplaySnapshot | undefined): boolean {
  return !!display && Boolean(
    display.fields?.length
    || display.references?.length
    || display.entities?.length
    || display.changes?.length
    || display.note,
  );
}

export default function AgentToolDetails({
  input,
  result,
  defaultExpanded = false,
}: AgentToolDetailsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const nodes = useAppStore((state) => state.nodes);
  // React SSR 使用 Store 初始快照；测试与独立窗口预渲染时仍应读取当前已加载节点。
  const currentNodes = nodes.length > 0 ? nodes : useAppStore.getState().nodes;
  if (!hasDisplay(input) && !hasDisplay(result)) return null;

  const references = [...(input?.references ?? []), ...(result?.references ?? [])];
  const entities = [...(input?.entities ?? []), ...(result?.entities ?? [])];
  const changes = [...(input?.changes ?? []), ...(result?.changes ?? [])];

  return (
    <div className="mt-1.5 rounded-md border border-canvas-border/60 bg-canvas-bg/25">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] text-canvas-text-muted transition-colors hover:bg-canvas-hover/50 hover:text-canvas-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/40"
      >
        <Icon icon="mdi:tune-variant" width="13" />
        <span>调用详情</span>
        <Icon
          icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
          width="14"
          className="ml-auto"
        />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-canvas-border/50 px-2 py-2 text-[11px] leading-[17px]">
          {input?.fields?.length ? (
            <div>
              <p className="mb-1 font-medium text-canvas-text-secondary">参数</p>
              <dl className="space-y-0.5">
                {input.fields.map((field, index) => (
                  <div key={`${field.label}-${index}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                    <dt className="text-canvas-text-muted">{field.label}</dt>
                    <dd className="min-w-0 break-words text-canvas-text-secondary">
                      {formatValue(field.value)}
                      {field.source && (
                        <span className="ml-1.5 text-[10px] text-canvas-text-muted">
                          {SOURCE_LABELS[field.source]}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {references.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-canvas-text-secondary">参考素材</p>
              <div className="grid grid-cols-2 gap-1.5">
                {references.map((reference, index) => {
                  const node = reference.kind === 'node'
                    ? currentNodes.find((item) => item.id === reference.id)
                    : undefined;
                  const preview = node && reference.mediaKind === 'image'
                    ? node.data.imageUrl || node.data.thumbnailUrl
                    : node?.data.thumbnailUrl;
                  return (
                    <div
                      key={`${reference.kind}-${reference.id}-${index}`}
                      className="flex min-w-0 items-center gap-1.5 rounded border border-canvas-border/60 bg-canvas-surface/50 p-1.5"
                    >
                      {preview ? (
                        <img
                          src={preview}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-canvas-hover text-canvas-text-muted">
                          <Icon
                            icon={reference.mediaKind === 'video'
                              ? 'mdi:video-outline'
                              : reference.mediaKind === 'audio'
                                ? 'mdi:music-note-outline'
                                : 'mdi:image-outline'}
                            width="16"
                          />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-canvas-text-secondary">{reference.label}</span>
                        <span className="block truncate text-[10px] text-canvas-text-muted">
                          {reference.kind === 'node'
                            ? node ? reference.id : '素材已不可用'
                            : '用户上传素材'}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {entities.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-canvas-text-secondary">对象</p>
              <div className="space-y-1">
                {entities.map((entity, index) => (
                  <div key={`${entity.id ?? entity.title}-${index}`} className="rounded border border-canvas-border/50 px-2 py-1.5">
                    <p className="break-words text-canvas-text-secondary">{entity.title}</p>
                    {entity.subtitle && <p className="text-canvas-text-muted">{entity.subtitle}</p>}
                    {entity.fields?.map((field, fieldIndex) => (
                      <p key={`${field.label}-${fieldIndex}`} className="text-canvas-text-muted">
                        {field.label}：<span className="text-canvas-text-secondary">{formatValue(field.value)}</span>
                      </p>
                    ))}
                    {entity.preview && (
                      <p className="mt-1 break-words border-t border-canvas-border/40 pt-1 text-canvas-text-muted">
                        {entity.preview}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {changes.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-canvas-text-secondary">变更</p>
              <div className="space-y-1">
                {changes.map((change, index) => (
                  <div key={`${change.targetId}-${change.field}-${index}`} className="rounded border border-canvas-border/50 px-2 py-1.5">
                    <p className="truncate text-canvas-text-secondary">
                      {change.targetLabel || change.targetId} · {change.field}
                    </p>
                    <p className="break-words text-canvas-text-muted">
                      {formatValue(change.before)}
                      <Icon icon="mdi:arrow-right" width="12" className="mx-1 inline" />
                      <span className="text-canvas-text-secondary">{formatValue(change.after)}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result?.fields?.length ? (
            <div>
              <p className="mb-1 font-medium text-canvas-text-secondary">结果</p>
              <dl className="space-y-0.5">
                {result.fields.map((field, index) => (
                  <div key={`${field.label}-${index}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                    <dt className="text-canvas-text-muted">{field.label}</dt>
                    <dd className="break-words text-canvas-text-secondary">{formatValue(field.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {(input?.note || result?.note) && (
            <p className="break-words text-canvas-text-muted">{result?.note || input?.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

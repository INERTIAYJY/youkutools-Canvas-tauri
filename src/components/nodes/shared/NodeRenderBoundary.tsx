/**
 * NodeRenderBoundary — 节点级错误边界
 *
 * 单个节点组件渲染抛错时，只把该节点降级成一张「渲染失败」占位卡，
 * 画布其余节点照常可用（脏数据/迁移遗留字段不再整页白屏）。
 * 占位卡保留左右 Handle，连到该节点的连线仍能正常锚定。
 */
import {
  Component,
  useCallback,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from '@xyflow/react';
import { Icon } from '@iconify/react';
import ModalOverlay from '../../shared/ModalOverlay';
import PopupCloseButton from '../../shared/PopupCloseButton';
import { useAppStore } from '../../../store/useAppStore';
import { useT } from '../../../i18n';

const FALLBACK_WIDTH = 320;
/** 数据预览里超长字符串（data URL / base64）只留头部，避免把几 MB 塞进 DOM */
const MAX_STRING_PREVIEW = 160;

interface NodeCrashCardProps {
  nodeId: string;
  typeName: string;
  data: unknown;
  error: unknown;
  onRetry: () => void;
}

/** 安全序列化节点数据：截断超长字符串、跳过循环引用，任何异常都退化成提示文本 */
function stringifyNodeData(data: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === 'string' && value.length > MAX_STRING_PREVIEW) {
          return `${value.slice(0, MAX_STRING_PREVIEW)}…（共 ${value.length} 字符）`;
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[循环引用]';
          seen.add(value);
        }
        return value;
      },
      2,
    ) ?? String(data);
  } catch (e) {
    return `无法序列化节点数据：${e instanceof Error ? e.message : String(e)}`;
  }
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function NodeCrashCard({ nodeId, typeName, data, error, onRetry }: NodeCrashCardProps) {
  const t = useT();
  const deleteNode = useAppStore((s) => s.deleteNode);
  const [isDataOpen, setIsDataOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const nodeData = (data ?? {}) as { label?: string; displayId?: number; nodeWidth?: number };
  const width = typeof nodeData.nodeWidth === 'number' && nodeData.nodeWidth > 0
    ? nodeData.nodeWidth
    : FALLBACK_WIDTH;
  const dataText = useMemo(
    () => (isDataOpen ? stringifyNodeData(data) : ''),
    [isDataOpen, data],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(dataText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }, [dataText]);

  return (
    <div className="node-wrapper" style={{ width }}>
      <div
        className="node nodrag relative flex flex-col gap-2 border border-danger/40 bg-canvas-card/90 p-3"
        role="alert"
      >
        <div className="flex items-center gap-2">
          <Icon
            icon="lucide:triangle-alert"
            width={14}
            height={14}
            className="shrink-0 text-danger-light"
            aria-hidden="true"
          />
          <span className="truncate text-xs font-medium text-canvas-text">{t('此节点渲染失败')}</span>
          {nodeData.displayId != null && (
            <span className="ml-auto shrink-0 text-[10px] text-canvas-text-muted">
              #{nodeData.displayId}
            </span>
          )}
        </div>

        <p className="text-[11px] leading-5 text-canvas-text-secondary">
          <span className="text-canvas-text-muted">{typeName}</span>
          {nodeData.label ? ` · ${nodeData.label}` : ''}
          <br />
          <span className="break-words">{errorMessageOf(error)}</span>
        </p>

        <div className="nodrag nopan flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-text transition-colors hover:bg-canvas-hover"
            onClick={() => setIsDataOpen(true)}
          >
            {t('查看数据')}
          </button>
          <button
            type="button"
            className="rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-text transition-colors hover:bg-canvas-hover"
            onClick={onRetry}
          >
            {t('重试渲染')}
          </button>
          <button
            type="button"
            className="ml-auto rounded-md border border-danger/40 px-2 py-1 text-[11px] text-danger-light transition-colors hover:bg-danger/10"
            onClick={() => deleteNode(nodeId)}
          >
            {t('删除节点')}
          </button>
        </div>

        <Handle
          type="source"
          position={Position.Left}
          id="left"
          className="node-handle handle-source"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="node-handle handle-source"
        />
      </div>

      {isDataOpen && createPortal(
        <ModalOverlay
          isOpen={isDataOpen}
          onClose={() => setIsDataOpen(false)}
          ariaLabel={t('节点数据')}
          className="w-[min(680px,calc(100vw-48px))] max-h-[70vh] border-canvas-border"
          motionPreset="quick"
        >
          <div className="flex items-center gap-2 border-b border-canvas-border px-4 py-3">
            <span className="text-sm font-medium text-canvas-text">{t('节点数据')}</span>
            <span className="truncate text-xs text-canvas-text-muted">
              {typeName} · {nodeId}
            </span>
            <button
              type="button"
              className="ml-auto shrink-0 rounded-md border border-canvas-border px-2 py-1 text-xs text-canvas-text transition-colors hover:bg-canvas-hover"
              onClick={handleCopy}
            >
              {copied ? t('已复制') : t('复制')}
            </button>
            <PopupCloseButton onClick={() => setIsDataOpen(false)} />
          </div>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-5 text-canvas-text-secondary">
            {dataText}
          </pre>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  );
}

interface NodeRenderBoundaryProps {
  nodeId: string;
  typeName: string;
  data: unknown;
  children: ReactNode;
}

interface NodeRenderBoundaryState {
  error: unknown;
}

export default class NodeRenderBoundary extends Component<
  NodeRenderBoundaryProps,
  NodeRenderBoundaryState
> {
  state: NodeRenderBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): NodeRenderBoundaryState {
    return { error: error ?? new Error('未知渲染错误') };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[NodeRenderBoundary] 节点 ${this.props.nodeId}（${this.props.typeName}）渲染失败`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <NodeCrashCard
        nodeId={this.props.nodeId}
        typeName={this.props.typeName}
        data={this.props.data}
        error={this.state.error}
        onRetry={this.handleRetry}
      />
    );
  }
}


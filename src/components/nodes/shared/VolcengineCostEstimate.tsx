/**
 * VolcengineCostEstimate — 提供方舟费用估算界面与交互。
 */
import { Icon } from '@iconify/react';
import type { BaseNodeData } from '../../../types';
import { mapImageDimensions } from '../../../services/aiDimensions';
import { normalizeSeedreamSize } from '../../../services/ai/helpers';
import { getImageCapability } from '../../../services/ai/mediaModelCapabilities';
import { getVolcengineSeedanceCapability, isVolcengineSeedance25Model } from '../../../services/ai/volcengineVideoModels';
import { quoteVolcengineImage, quoteVolcengineVideo, formatCny } from '../../../services/billing/volcenginePricing';

export default function VolcengineCostEstimate({ data, onOpenRecords }: { data: BaseNodeData; onOpenRecords: () => void }) {
  if (data.provider !== 'volcengine' || data.workflowId || !data.model || !['ai-image', 'ai-video'].includes(data.type)) return null;
  const video = data.type === 'ai-video';
  const size = String(data.imageSize || '2K');
  const ratio = String(data.aspectRatio || '1:1');
  const modelId = data.model.replace(/^volcengine\//, '');
  const normalizedSize = normalizeSeedreamSize(modelId, size);
  const preset = getImageCapability(modelId)?.dimensionPresets?.[normalizedSize]?.[ratio];
  const dimensions = ratio === '自适应' || ratio === 'auto' ? undefined
    : preset ? { width: preset[0], height: preset[1] } : mapImageDimensions(normalizedSize, ratio);
  const hasInputVideo = data.videoReferences?.some((item) => item.mediaKind === 'video') || false;
  const hasFrameReference = data.videoReferences?.some((item) => item.role === 'first_frame' || item.role === 'last_frame') || false;
  const videoCapability = getVolcengineSeedanceCapability(modelId);
  const seedance25 = isVolcengineSeedance25Model(modelId);
  const videoDuration = seedance25 && hasInputVideo ? videoCapability?.automaticDurationValue ?? -1
    : data.seedanceDuration ?? videoCapability?.defaultDuration ?? videoCapability?.automaticDurationValue ?? 5;
  const videoRatio = seedance25 && (hasInputVideo || hasFrameReference) ? 'adaptive'
    : String(data.seedanceRatio || videoCapability?.defaultRatio || '16:9').replace(/^auto$/, 'adaptive');
  const videoResolution = String(data.seedanceResolution || videoCapability?.defaultResolution || '720p');
  const quote = video ? quoteVolcengineVideo({
    modelId: data.model,
    durationSeconds: videoDuration,
    resolution: videoResolution,
    ratio: videoRatio,
    fps: data.videoFps,
    inputVideoSeconds: hasInputVideo ? 1 : undefined,
  }) : quoteVolcengineImage({
    modelId: data.model, inputImageCount: 0,
    outputCount: Number(data.batchCount) || 1,
    width: dimensions?.width, height: dimensions?.height,
  });
  const example = video && quote.amountMicros === null && !hasInputVideo
    && (videoDuration < 0 || videoRatio === 'adaptive')
    ? quoteVolcengineVideo({ modelId: data.model, durationSeconds: videoDuration < 0 ? 5 : videoDuration,
      resolution: videoResolution, ratio: videoRatio === 'adaptive' ? '16:9' : videoRatio, fps: data.videoFps })
    : null;
  const hasExample = example?.amountMicros !== null && example?.amountMicros !== undefined;

  const amount = hasExample ? formatCny(example.amountMicros) : formatCny(quote.amountMicros);
  const label = hasExample ? `示例 ${amount}` : quote.amountMicros === null ? '待估价' : `预计 ${amount}`;
  const explanation = hasExample
    ? `按${videoDuration < 0 ? '5 秒' : `${videoDuration} 秒`}${videoRatio === 'adaptive' ? '、16:9 画幅' : ''}作示例；实际费用可能不同。`
    : quote.reason;

  return <button
    type="button"
    className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 text-xs text-canvas-text-secondary hover:bg-canvas-hover hover:text-canvas-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-canvas-text"
    title={`${explanation} 点击查看火山方舟用量记录；最终扣费以方舟账单为准。`}
    aria-label={`${label}，查看火山方舟用量记录`}
    onClick={onOpenRecords}
  >
    <Icon icon="lucide:receipt-text" width="14" />
    <span>{label}</span>
  </button>;
}

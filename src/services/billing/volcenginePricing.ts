/**
 * volcenginePricing — 按价格快照估算方舟图片与视频费用。
 */
export const VOLCENGINE_PRICE_VERSION = 'user-price-document-2026-09-26';

export type PriceQuote = {
  amountMicros: number | null;
  reason: string;
  priceVersion: string;
  rule: string;
};

const IMAGE_OUTPUT_MICROS: Record<string, number> = {
  'doubao-seedream-5-0-flash': 120_000,
  'doubao-seedream-5-0-lite': 220_000,
  'doubao-seedream-4-5': 250_000,
  'doubao-seedream-4-0': 200_000,
};

function modelFamily(modelId: string): string {
  const name = modelId.replace(/^volcengine\//, '').toLowerCase();
  return name.replace(/-\d{6,}$/, '').replace(/(seedance-\d)\.(\d)/, '$1-$2');
}

export function quoteVolcengineImage(input: {
  modelId: string;
  inputImageCount: number;
  outputCount: number;
  width?: number;
  height?: number;
  scene?: 'single' | 'layer-split';
}): PriceQuote {
  const family = modelFamily(input.modelId);
  const count = Math.max(1, Math.floor(input.outputCount));
  const flatPrice = IMAGE_OUTPUT_MICROS[family];
  if (flatPrice !== undefined) return {
    amountMicros: flatPrice * count,
    reason: '按实际成功输出图片数量核算；失败输出不计费',
    priceVersion: VOLCENGINE_PRICE_VERSION,
    rule: `${family}: ${flatPrice} 微元/张`,
  };
  if (family === 'doubao-seedream-5-0-pro') {
    if (!input.width || !input.height) return { amountMicros: null, reason: '自适应尺寸尚未确定，无法匹配像素档', priceVersion: VOLCENGINE_PRICE_VERSION, rule: family };
    const large = input.width * input.height > 2_610_000;
    const outputPrice = input.scene === 'layer-split'
      ? (large ? 300_000 : 150_000)
      : (large ? 600_000 : 300_000);
    return {
      amountMicros: Math.max(0, input.inputImageCount - 1) * 20_000 + outputPrice * count,
      reason: '输入首张免费；输出按像素档计费',
      priceVersion: VOLCENGINE_PRICE_VERSION,
      rule: `${family}: ${large ? '>261万' : '≤261万'}像素，${input.scene ?? 'single'}`,
    };
  }
  return { amountMicros: null, reason: '价格目录未收录当前图片模型', priceVersion: VOLCENGINE_PRICE_VERSION, rule: family };
}

const VIDEO_RATES: Record<string, Record<string, number>> = {
  'doubao-seedance-2-5': { '480p': 70, '720p': 70, '1080p': 77 },
  'doubao-seedance-2-0': { '480p': 46, '720p': 46, '1080p': 51, '4k': 26 },
  'doubao-seedance-2-0-fast': { '480p': 37, '720p': 37 },
  'doubao-seedance-2-0-mini': { '480p': 23, '720p': 23 },
};
const VIDEO_INPUT_RATES: Record<string, Record<string, number>> = {
  'doubao-seedance-2-5': { '480p': 42, '720p': 42, '1080p': 46 },
  'doubao-seedance-2-0': { '480p': 28, '720p': 28, '1080p': 31, '4k': 16 },
  'doubao-seedance-2-0-fast': { '480p': 22, '720p': 22 },
  'doubao-seedance-2-0-mini': { '480p': 14, '720p': 14 },
};

export function quoteVolcengineVideo(input: {
  modelId: string;
  durationSeconds: number;
  resolution: string;
  ratio: string;
  fps?: number;
  inputVideoSeconds?: number;
  completionTokens?: number;
}): PriceQuote {
  const family = modelFamily(input.modelId);
  const resolution = input.resolution.toLowerCase();
  const rate = (input.inputVideoSeconds ? VIDEO_INPUT_RATES : VIDEO_RATES)[family]?.[resolution];
  const base = { priceVersion: VOLCENGINE_PRICE_VERSION, rule: `${family}: ${rate ?? '?'} 元/百万 token` };
  if (!rate) return { ...base, amountMicros: null, reason: '价格目录未收录此模型与分辨率组合' };
  if (input.completionTokens !== undefined && input.completionTokens >= 0) return {
    ...base, amountMicros: Number(BigInt(Math.round(input.completionTokens)) * BigInt(rate)),
    reason: '根据方舟返回的 completion_tokens 按刊例价核算',
  };
  if (input.durationSeconds < 0) return { ...base, amountMicros: null, reason: '自动时长尚未确定' };
  if (input.inputVideoSeconds) return { ...base, amountMicros: null, reason: '包含视频输入，最低 Token 用量需按官方规则确认' };
  const dimensions: Record<string, [number, number]> = {
    '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160],
  };
  const size = dimensions[resolution];
  if (!size || input.ratio === 'adaptive') return { ...base, amountMicros: null, reason: '输出画幅或尺寸尚未确定' };
  const [ratioWidth, ratioHeight] = input.ratio.split(':').map(Number);
  if (!ratioWidth || !ratioHeight) return { ...base, amountMicros: null, reason: '画幅比例无法解析' };
  const [maxWidth, maxHeight] = size;
  const width = ratioWidth >= ratioHeight ? maxWidth : Math.round(maxHeight * ratioWidth / ratioHeight);
  const height = ratioWidth >= ratioHeight ? Math.round(maxWidth * ratioHeight / ratioWidth) : maxHeight;
  const fps = input.fps ?? 24;
  const tokens = Math.ceil(input.durationSeconds * width * height * fps / 1024);
  return { ...base, amountMicros: Number(BigInt(tokens) * BigInt(rate)), reason: `按 ${width}×${height}、约 ${fps}fps 估算；实际以方舟 Usage 为准` };
}

export function formatCny(micros: number | null | undefined): string {
  return micros === null || micros === undefined ? '暂无法估算' : `¥${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * 无依赖的 token 估算工具。独立成叶子模块，供系统提示词构建等不能引入
 * contextManager（会经 contextCompressionService 回到 assistantStream）的场景复用。
 */

const CJK_PATTERN = /[⺀-鿿豈-﫿＀-￯]/g;

/**
 * 估算文本 token 数。
 * CJK 字符按 1 token/字，其余按 4 字符/token。仅用于预算判断，非精确值。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
  return Math.ceil(cjkCount + (text.length - cjkCount) / 4);
}

/** ComfyUI 响应校验与短查询预算；超时不用于生成提交、上传和长流。 */
export const COMFY_QUERY_TIMEOUT_MS = 15_000;

/** 普通操作的 HTTP 检查；轮询鉴权错误继续由轮询器单独处理。 */
export async function assertComfyResponse(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const detail = await response.text().catch(() => '');
  throw new Error(`${action}失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`);
}

export function withComfyQueryTimeout<T>(
  query: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = COMFY_QUERY_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (deliver: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      deliver();
    };
    const cancel = (reason: unknown) => {
      controller.abort(reason);
      finish(() => reject(reason));
    };
    const onAbort = () => cancel(signal?.reason ?? new DOMException('查询已取消', 'AbortError'));
    const timer = globalThis.setTimeout(() => cancel(new DOMException(
      'ComfyUI 状态查询超时，请检查连接后继续查询', 'TimeoutError',
    )), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      void query(controller.signal).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

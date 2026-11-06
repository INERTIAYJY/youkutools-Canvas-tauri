/**
 * comfyQuery — 回归测试：ComfyUI 响应读取合同与短查询预算。
 */
import { describe, expect, it, vi } from 'vitest';
import { assertComfyResponse, withComfyQueryTimeout } from '../../src/services/comfyQuery';

describe('ComfyUI 短查询预算', () => {
  it('连接不返回时结束等待并取消底层请求', async () => {
    let requestSignal: AbortSignal | undefined;
    const operation = withComfyQueryTimeout((signal) => {
      requestSignal = signal;
      return new Promise<never>(() => {});
    }, undefined, 1);
    await expect(operation).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('响应头已返回但读取 body 卡住时仍受同一预算约束', async () => {
    let responseReceived = false;
    const operation = withComfyQueryTimeout(async (signal) => {
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      }));
      responseReceived = true;
      return response.json();
    }, undefined, 1);
    await expect(operation).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(responseReceived).toBe(true);
  });

  it('外部取消立即结束查询，已取消的调用不启动请求', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const operation = withComfyQueryTimeout((signal) => {
      requestSignal = signal;
      return new Promise<never>(() => {});
    }, controller.signal);
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);
    let invoked = false;
    await expect(withComfyQueryTimeout(async () => { invoked = true; }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(invoked).toBe(false);
  });

  it('正常读完后清理监听，不让后续外部取消影响已完成请求', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    await expect(withComfyQueryTimeout(async (signal) => {
      requestSignal = signal;
      return { ok: true };
    }, controller.signal)).resolves.toEqual({ ok: true });
    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
  });
});

describe('ComfyUI 普通响应检查', () => {
  it('成功时不读取正文，调用方仍能正常解析 JSON', async () => {
    const response = new Response('{"ok":true}');
    const text = vi.spyOn(response, 'text');
    await expect(assertComfyResponse(response, '读取状态')).resolves.toBeUndefined();
    expect(text).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('失败时只读一次正文，保留动作及状态码并截断到 200 字符', async () => {
    const response = new Response('x'.repeat(240), { status: 503 });
    const text = vi.spyOn(response, 'text');
    await expect(assertComfyResponse(response, '读取状态')).rejects.toMatchObject({
      message: `读取状态失败（HTTP 503）：${'x'.repeat(200)}`,
    });
    expect(text).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(true);
  });

  it('正文不可读时保留 HTTP 错误，不透传读取异常或重读', async () => {
    const response = new Response('', { status: 500 });
    const text = vi.spyOn(response, 'text').mockRejectedValueOnce(new Error('body read failed'));
    await expect(assertComfyResponse(response, '释放资源')).rejects.toMatchObject({
      message: '释放资源失败（HTTP 500）',
    });
    expect(text).toHaveBeenCalledTimes(1);
  });
});

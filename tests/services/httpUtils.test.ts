/**
 * httpUtils — 回归测试：HTTP response failure classification。
 */
import { describe, expect, it } from 'vitest';
import { classifyHttpResponseFailure, getHttpResponseError, HttpResponseError, parseResponseError } from '../../src/services/ai/httpUtils';

describe('HTTP response failure classification', () => {
  it.each([
    { status: 400, payload: undefined, definitive: true },
    { status: 401, payload: { error: { message: 'Invalid key' } }, definitive: true },
    { status: 422, payload: { message: 'Unsupported request' }, definitive: true },
    { status: 408, payload: { status: 'failed', error: { code: 'invalid_request' } }, definitive: false },
    { status: 504, payload: { status: 'failed', error: { code: 'rate_limit_exceeded' } }, definitive: false },
    { status: 429, payload: { error: { code: 'rate_limit_exceeded' } }, definitive: true },
    { status: 429, payload: { message: 'rate_limit_exceeded' }, definitive: false },
    { status: 502, payload: { error: { code: 'upstream_error', message: 'Upstream request failed' } }, definitive: false },
    { status: 500, payload: { error: { code: 'insufficient_quota' } }, definitive: true },
    { status: 500, payload: { error: { message: 'insufficient_quota' } }, definitive: false },
    { status: 500, payload: { status: 'failed' }, definitive: true },
    { status: 200, payload: { error: { type: 'invalid_request_error' } }, definitive: true },
    { status: 200, payload: { data: { status: 'failed' } }, definitive: true },
    { status: 200, payload: { data: [{ status: 'failed' }, { status: 'failed' }] }, definitive: true },
    { status: 200, payload: { data: [{ status: 'failed' }, { task_id: 'accepted', status: 'pending' }] }, definitive: false },
    { status: 200, payload: { status: 'error', message: 'failed' }, definitive: false },
    { status: 200, payload: { data: [] }, definitive: false },
  ])('classifies HTTP $status with explicit evidence only: $definitive', ({ status, payload, definitive }) => {
    expect(classifyHttpResponseFailure(status, payload)).toBe(definitive);
  });
});

describe('HTTP response errors', () => {
  it('keeps the existing parsed message and finite metadata without retaining the response object', async () => {
    const payload = { error: { code: 'rate_limit_exceeded', message: 'Request rejected' }, debug: 'private response detail' };
    const error = await parseResponseError(new Response(JSON.stringify(payload), { status: 429 }), '图片生成失败 (429)').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toMatchObject({ status: 429, definitiveFailure: true, message: 'Request rejected' });
    expect(error).not.toHaveProperty('payload');
    expect(error).not.toHaveProperty('response');
    expect(JSON.stringify(error)).not.toContain('private response detail');
  });

  it('keeps the safe gateway timeout guidance and reports uncertain submission', async () => {
    await expect(parseResponseError(new Response('<html>gateway timeout</html>', { status: 504,
      headers: { 'Content-Type': 'text/html' } }), '图片生成失败 (504)')).rejects.toMatchObject({
      status: 504, definitiveFailure: false,
      message: '图片生成失败 (504)：网关等待上游响应超时（HTTP 504）。本次生成结果尚未确认，请先检查服务商任务记录，再决定是否重新生成。',
    });
  });

  it('preserves the original error message rules for plain text and API key errors', async () => {
    await expect(parseResponseError(new Response('upstream unavailable', { status: 502 }), '图片生成失败 (502)'))
      .rejects.toMatchObject({ status: 502, definitiveFailure: false, message: '图片生成失败 (502): upstream unavailable' });
    await expect(parseResponseError(new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }), '失败'))
      .rejects.toMatchObject({ status: 401, definitiveFailure: true,
        message: 'Invalid API Key（请确认使用模型 API Key，而非账户令牌；若密钥正确，请检查账户权限和积分余额）' });
  });

  it('finds typed errors through wrapping while ignoring forged metadata and cyclic causes', () => {
    const http = new HttpResponseError(504, 'Gateway timeout');
    expect(getHttpResponseError(new Error('Submission context', { cause: http }))).toBe(http);
    expect(getHttpResponseError(Object.assign(new Error('forged'), { status: 400, definitiveFailure: true }))).toBeUndefined();
    const cyclic = new Error('cycle');
    cyclic.cause = cyclic;
    expect(getHttpResponseError(cyclic)).toBeUndefined();
    let tooDeep: Error = http;
    for (let depth = 0; depth < 8; depth++) tooDeep = new Error('wrapper', { cause: tooDeep });
    expect(getHttpResponseError(tooDeep)).toBeUndefined();
  });
});

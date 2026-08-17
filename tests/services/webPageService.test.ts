import { describe, expect, it } from 'vitest';
import { shouldRenderDynamicHtml } from '../../src/services/webPageService';

describe('web page SPA rendering fallback', () => {
  it('requests rendering for an empty application root with a JavaScript bundle', () => {
    const html = `
      <!doctype html>
      <html>
        <head><script type="module" src="/assets/index.js"></script></head>
        <body><div id="root"></div></body>
      </html>
    `;

    expect(shouldRenderDynamicHtml(html, 'text/html; charset=utf-8', '')).toBe(true);
  });

  it('requests rendering for a hashed non-module bundle (e.g. /static/js/index.xxx.js)', () => {
    const html = `
      <!doctype html>
      <html>
        <head><script defer src="/static/js/index.55998905b6.js"></script></head>
        <body><div id="root"></div></body>
      </html>
    `;

    expect(shouldRenderDynamicHtml(html, 'text/html; charset=utf-8', '')).toBe(true);
  });

  it('keeps substantial server-rendered HTML on the static path', () => {
    const html = `
      <html><body><main>${'<p>API documentation</p>'.repeat(80)}</main>
      <script type="module" src="/assets/index.js"></script></body></html>
    `;

    expect(shouldRenderDynamicHtml(html, 'text/html', 'API documentation '.repeat(80)))
      .toBe(false);
  });

  it('does not render ordinary short HTML without SPA markers', () => {
    expect(shouldRenderDynamicHtml(
      '<html><body><main><p>Short status page</p></main></body></html>',
      'text/html',
      'Short status page',
    )).toBe(false);
  });

  it('does not attempt browser rendering for JSON or XML responses', () => {
    expect(shouldRenderDynamicHtml('{"status":"ok"}', 'application/json', 'status ok'))
      .toBe(false);
    expect(shouldRenderDynamicHtml('<rss></rss>', 'application/rss+xml', '')).toBe(false);
  });
});

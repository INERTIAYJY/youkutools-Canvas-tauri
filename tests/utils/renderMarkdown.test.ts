import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/utils/renderMarkdown';

describe('renderMarkdown URL sanitization', () => {
  it.each([
    'javascript:alert(1)',
    'java\u0000script:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])('does not create a link for unsafe URL %s', (url) => {
    const html = renderMarkdown(`[打开](${url})`);

    expect(html).toContain('打开');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj4=',
    'file:///etc/passwd',
  ])('does not create an image for unsafe URL %s', (url) => {
    const html = renderMarkdown(`![预览](${url})`);

    expect(html).toContain('预览');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('src=');
  });

  it.each([
    'https://example.com/docs',
    'http://example.com/docs',
    'mailto:user@example.com',
    './docs/guide.md',
    '#section',
  ])('keeps safe link URL %s', (url) => {
    expect(renderMarkdown(`[文档](${url})`)).toContain('<a href=');
  });

  it.each([
    'https://example.com/image.png',
    './images/preview.webp',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('keeps safe image URL %s', (url) => {
    expect(renderMarkdown(`![预览](${url})`)).toContain('<img src=');
  });
});

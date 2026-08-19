import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, getLocale, normalizeLocale, setLocale, t } from '../../src/i18n';
import enUS from '../../src/i18n/locales/en-US';

afterEach(() => {
  setLocale('zh-CN');
});

describe('i18n runtime', () => {
  it('falls back to the Chinese source text when a translation is missing', () => {
    setLocale('en-US');
    expect(t('这条文案没有英文词条')).toBe('这条文案没有英文词条');
  });

  it('translates and interpolates named placeholders', () => {
    setLocale('en-US');
    expect(t('设置')).toBe('Settings');
    expect(t('发现新版本 v{version}', { version: '1.2.3' })).toBe('New version v1.2.3 available');
  });

  it('keeps unknown placeholders literal instead of printing undefined', () => {
    setLocale('en-US');
    expect(t('资产 · 新增短剧资产 ({count})')).toBe('Assets · {count} new drama asset(s)');
  });

  it('normalizes BCP-47 tags and falls back to Chinese for unsupported languages', () => {
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('fr-FR')).toBe('zh-CN');
    expect(normalizeLocale(undefined)).toBe('zh-CN');
  });

  it('treats an empty language setting as "follow the system"', () => {
    setLocale('en-US');
    setLocale(undefined);
    expect(getLocale()).toBe(detectLocale());
  });
});

/**
 * 中文原文即 key：改动源码里的中文文案会静默丢失英文翻译。
 * 这条用例扫描全仓，把已经不存在于源码的词条揪出来。
 */
describe('en-US dictionary', () => {
  const SRC = join(__dirname, '../../src');

  function collectSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // 词条文件本身当然包含 key，扫描时必须跳过，否则这条用例永远通过
      if (entry.name === 'locales') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectSources(full, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(full, 'utf8'));
    }
    return out;
  }

  it('has no entry whose Chinese source text disappeared from the codebase', () => {
    const sources = collectSources(SRC).join('\n');
    const orphans = Object.keys(enUS).filter((key) => !sources.includes(key));
    expect(orphans).toEqual([]);
  });

  it('declares the same placeholders on both sides of every entry', () => {
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
    const mismatched = Object.entries(enUS)
      .filter(([zh, en]) => placeholders(zh).join() !== placeholders(en).join())
      .map(([zh]) => zh);
    expect(mismatched).toEqual([]);
  });
});

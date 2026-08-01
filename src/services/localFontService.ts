import { invoke } from '@tauri-apps/api/core';

export interface LocalFontOption {
  label: string;
  value: string;
}

interface LocalFontData {
  family: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

const SYSTEM_FONT_OPTIONS: LocalFontOption[] = [
  { label: '系统默认', value: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: '无衬线', value: 'sans-serif' },
  { label: '衬线', value: 'serif' },
  { label: '等宽', value: 'monospace' },
];
let cachedFontOptions: LocalFontOption[] | null = null;

function toCssFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`;
}

export function getSystemFontOptions(): LocalFontOption[] {
  return SYSTEM_FONT_OPTIONS;
}

/** 通过 Local Font Access API 枚举字体 family；首次调用可能触发系统授权。 */
export async function queryLocalFontOptions(): Promise<LocalFontOption[]> {
  if (cachedFontOptions) return cachedFontOptions;
  const fontGlobal = globalThis as typeof globalThis & {
    queryLocalFonts?: QueryLocalFonts;
  };
  let familyNames: string[];
  if (fontGlobal.queryLocalFonts) {
    try {
      const fonts = await fontGlobal.queryLocalFonts();
      familyNames = fonts.map((font) => font.family);
    } catch {
      familyNames = await invoke<string[]>('list_local_fonts');
    }
  } else {
    familyNames = await invoke<string[]>('list_local_fonts');
  }
  const families = [...new Set(familyNames.map((family) => family.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  cachedFontOptions = [
    ...SYSTEM_FONT_OPTIONS,
    ...families.map((family) => ({ label: family, value: toCssFamily(family) })),
  ];
  return cachedFontOptions;
}

/**
 * appearanceMigration — 将旧主题配置迁移为完整外观配置。
 */
import type { AppConfig, AppearanceTheme } from '../../types';
import { getBuiltinAppearanceTheme } from './appearanceDefaults';

function legacyCanvasKind(config: AppConfig): AppearanceTheme['canvas']['kind'] {
  if (config.canvasBackground === 'solar-system') return 'solar-system';
  if (config.canvasBackground === 'frosted-glass') return 'frosted-glass';
  if (config.canvasBackground === 'custom' && config.customBackgroundUrl) return 'image';
  return 'color';
}

/** 将旧版分散的主题/画布字段一次性收敛为完整外观快照。 */
export function migrateLegacyAppearance(config: AppConfig): AppearanceTheme {
  const mode = config.theme === 'light' ? 'light' : config.theme === 'system' ? 'system' : 'dark';
  const builtinId = config.canvasBackground === 'solar-system'
    ? 'solar-system'
    : config.canvasBackground === 'frosted-glass'
      ? 'frosted-warm-light'
      : `standard-${mode === 'light' ? 'light' : 'dark'}`;
  const base = getBuiltinAppearanceTheme(builtinId, mode === 'light' ? 'light' : 'dark');
  return {
    ...base,
    mode,
    canvas: {
      ...base.canvas,
      kind: legacyCanvasKind(config),
      color: config.canvasBackground === 'off-white'
        ? config.offWhiteBackgroundColor ?? base.canvas.color
        : config.defaultDarkBackgroundShade !== undefined
          ? `rgb(${config.defaultDarkBackgroundShade} ${config.defaultDarkBackgroundShade} ${config.defaultDarkBackgroundShade})`
          : base.canvas.color,
      imageDataUrl: config.customBackgroundUrl,
      imageOpacity: config.customBackgroundOpacity ?? base.canvas.imageOpacity,
    },
  };
}

export function getAppearanceForConfig(config: AppConfig | null | undefined): AppearanceTheme {
  if (config?.appearance) return config.appearance;
  return migrateLegacyAppearance(config ?? {
    providers: {},
    theme: 'dark',
    canvasBackground: 'default',
  });
}

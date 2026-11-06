/**
 * cinematography — 处理摄影设置、器材兼容提示与生成提示词。
 */
import type { CameraAperture, CameraGenerationSettings, CameraLens, CameraShutterEffect } from '../types';
import type { CinemaCamera, CinemaFormat, CinemaLens, CinematographySettings } from '../types/cinematography';
import { CINEMA_CAMERAS, CINEMA_EFFECTS, CINEMA_FILM_STOCKS, CINEMA_LENSES } from '../data/cinematography';

export const CINEMA_FORMAT_LABELS: Record<CinemaFormat, string> = { s16: 'Super 16', s35: 'Super 35', ff: 'Full Frame', lf: 'Large Format', vv: 'VistaVision' };
export const CINEMA_T_STOPS = [1, 1.3, 1.4, 1.5, 1.8, 1.9, 2, 2.2, 2.3, 2.6, 2.8, 2.9, 4, 5.6, 8, 11, 16, 22];
export function resolveCinematography(defaults?: CinematographySettings, override?: CinematographySettings): CinematographySettings {
  const resolved = { ...defaults };
  for (const key of Object.keys(override ?? {}) as (keyof CinematographySettings)[]) {
    if (override![key] !== undefined) Object.assign(resolved, { [key]: override![key] });
  }
  return resolved;
}
export function supportsCinemaFocal(lens: CinemaLens, focal: number): boolean {
  return Number.isFinite(focal) && (lens.zoom ? focal >= lens.zoom[0] && focal <= lens.zoom[1] : lens.focalLengths.includes(focal));
}
export function cinemaMinT(lens?: CinemaLens, focal?: number | null): number {
  return (focal != null ? lens?.minTByFocal?.[focal] : undefined) ?? lens?.minT ?? 1;
}
function recordingFormat(settings: CinematographySettings, camera?: CinemaCamera): CinemaFormat | undefined {
  const format = settings.recordingFormat;
  return format && format in CINEMA_FORMAT_LABELS && (!camera || camera.formats.includes(format)) ? format : camera?.formats[0];
}
/** 推荐提示只覆盖目录明确知道的接口/格式，不把大类匹配宣称为完整实拍校验。 */
export function cinematographyCompatibility(settings: CinematographySettings): string[] {
  const camera = CINEMA_CAMERAS.find((item) => item.id === settings.cameraId);
  const lens = CINEMA_LENSES.find((item) => item.id === settings.lensId);
  if (!camera || !lens) return [];
  const notes: string[] = [];
  if (!lens.mounts.includes(camera.mount)) notes.push(lens.mounts.some((mount) => camera.adapters.includes(mount))
    ? '此搭配需转接或更换卡口配置' : '此卡口组合需进一步核对，可作为画面风格参考');
  const format = recordingFormat(settings, camera);
  if (lens.coverage === 's35' && format && !['s16', 's35'].includes(format)) notes.push('Super 35 镜头建议选择可覆盖的 Super 35 记录窗口');
  if (lens.coverage === 'ff' && (format === 'lf' || format === 'vv')) notes.push('大画幅模式需核对镜头像场，Full Frame 标记不保证覆盖全部窗口');
  if (settings.recordingFormat && !camera.formats.includes(settings.recordingFormat)) notes.push('当前记录窗口不在该机身目录中，请重新选择');
  if (settings.focalLengthMm != null && !supportsCinemaFocal(lens, settings.focalLengthMm)) notes.push('当前焦段不在所选镜头目录中，请重新选择');
  if (settings.apertureT != null && settings.apertureT < cinemaMinT(lens, settings.focalLengthMm)) notes.push('当前光圈超过该镜头目录的最大光圈，请重新选择');
  return notes;
}
export function cinematographySummary(settings: CinematographySettings, translate: (value: string) => string = (value) => value): string {
  const effect = CINEMA_EFFECTS.find((item) => item.id === settings.effectId);
  return [CINEMA_CAMERAS.find((item) => item.id === settings.cameraId)?.name,
    CINEMA_LENSES.find((item) => item.id === settings.lensId)?.name,
    settings.focalLengthMm ? `${settings.focalLengthMm}mm` : undefined,
    settings.apertureT ? `T${settings.apertureT}` : undefined,
    effect ? translate(effect.name) : undefined].filter(Boolean).join(' · ');
}

const LENS_PROMPTS: Record<CameraLens, string> = {
  '15mm': '15mm ultra-wide lens', '24mm': '24mm wide-angle lens', '35mm': '35mm cinematic lens',
  '50mm': '50mm natural perspective lens', '85mm': '85mm portrait lens', '200mm': '200mm telephoto lens compression',
  macro: '100mm macro lens, extreme close-up, 1:1 magnification, fine surface detail', fisheye: 'fisheye lens distortion',
};
export function describeCameraLens(lens: CameraLens): string { return LENS_PROMPTS[lens]; }
const SHUTTER_PROMPTS: Record<CameraShutterEffect, string> = {
  freeze: 'high-speed shutter effect, crisp frozen motion', natural: 'natural shutter motion rendering',
  motion: 'slow-shutter motion blur', 'light-trails': 'long-exposure light trails',
};
const APERTURE_PROMPTS: Record<CameraAperture, string> = {
  'f/1.4': 'f/1.4 wide aperture, extremely shallow depth of field', 'f/2': 'f/2 wide aperture, shallow depth of field',
  'f/2.8': 'f/2.8 aperture, soft background separation', 'f/4': 'f/4 aperture, balanced depth of field',
  'f/5.6': 'f/5.6 aperture, moderate depth of field', 'f/8': 'f/8 aperture, deep depth of field',
  'f/11': 'f/11 narrow aperture, extensive depth of field', 'f/16': 'f/16 narrow aperture, maximum depth of field',
};
const DEPTH = { shallow: 'shallow depth of field, soft background separation', balanced: 'balanced depth of field', deep: 'deep depth of field, readable foreground and background' };
const FOCUS = { eyes: 'focus on the subject eyes', foreground: 'focus on the foreground subject', background: 'focus on the distant subject', rack: 'deliberate rack focus between foreground and background subjects' };
const GRAIN = { none: 'clean image without added film grain', subtle: 'subtle organic film grain varying between frames', visible: 'visible organic film grain varying between frames' };
const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** 旧数值焦段和快门可无损接入新表单；f 值不冒充 T 值，微距/鱼眼与曝光原样保留。 */
export function editableGenerationCinematography(settings?: CameraGenerationSettings): CinematographySettings | undefined {
  const focal = settings?.lens ? Number.parseFloat(settings.lens) : undefined;
  const compatible: CinematographySettings = {};
  if (finitePositive(focal)) compatible.focalLengthMm = focal;
  if (settings?.shutterEffect) compatible.shutterEffect = settings.shutterEffect;
  const value = resolveCinematography(compatible, settings?.cinematography);
  return Object.keys(value).length ? value : undefined;
}

/** 现有节点参数显式覆盖分镜同类参数；所有入口共用，只有旧参数时输出保持原格式。 */
export function buildGenerationCameraPrompt(legacy?: CameraGenerationSettings, settings?: CinematographySettings): string {
  const own = legacy?.cinematography;
  if (own) {
    settings = resolveCinematography(settings, own);
    legacy = { ...legacy,
      lens: own.focalLengthMm !== undefined || own.lensId !== undefined ? undefined : legacy?.lens,
      aperture: own.apertureT !== undefined || own.depthOfField !== undefined ? undefined : legacy?.aperture,
      shutterEffect: own.shutterEffect !== undefined ? undefined : legacy?.shutterEffect,
    };
  }
  const camera = CINEMA_CAMERAS.find((item) => item.id === settings?.cameraId);
  const selectedLens = CINEMA_LENSES.find((item) => item.id === settings?.lensId);
  const overrideFocal = legacy?.lens ? Number.parseFloat(legacy.lens) : undefined;
  const focal = finitePositive(overrideFocal) ? overrideFocal : settings?.focalLengthMm;
  // 显式宏观/鱼眼或不属于镜头系列的焦段改用通用光学描述，不能编造型号。
  const lens = selectedLens && (!legacy?.lens || finitePositive(overrideFocal))
    && (!finitePositive(focal) || supportsCinemaFocal(selectedLens, focal)) ? selectedLens : undefined;
  const format = settings?.recordingFormat ? recordingFormat(settings, camera) : undefined;
  const stock = CINEMA_FILM_STOCKS.find((item) => item.id === settings?.filmStockId);
  const effect = CINEMA_EFFECTS.find((item) => item.id === settings?.effectId);
  const aperture = settings?.apertureT;
  const focusDistance = settings?.focusDistanceM;
  const cinematic: string[] = [
    camera ? `camera reference: ${camera.name}` : '',
    format ? `recording area reference: ${CINEMA_FORMAT_LABELS[format]}` : '',
    lens ? `lens reference: ${lens.name}` : '',
    lens?.look ?? '',
    !legacy?.lens && finitePositive(focal) && focal <= 1200 ? `${focal}mm focal length` : '',
    !legacy?.aperture && finitePositive(aperture) && aperture >= cinemaMinT(lens, focal) && aperture <= 32 ? `working aperture T${aperture}` : '',
    lens?.squeeze ? `${lens.squeeze}x anamorphic optical character, elliptical out-of-focus highlights, natural subject proportions after desqueeze` : '',
    lens?.macro ? 'probe macro perspective, close-focus fine surface detail' : '',
    effect && (effect.id !== 'anamorphic' || lens?.squeeze) && (effect.id !== 'macro' || lens?.macro || legacy?.lens === 'macro') ? effect.prompt : '',
    !legacy?.aperture && settings?.depthOfField ? DEPTH[settings.depthOfField] : '',
    settings?.focus ? FOCUS[settings.focus] : '',
    finitePositive(focusDistance) && focusDistance <= 10000 ? `focus distance reference ${focusDistance}m` : '',
    stock ? `${camera?.capture === 'film' ? 'film stock' : 'film emulation'} reference: ${stock.prompt}` : '',
    settings?.grain ? GRAIN[settings.grain] : '',
  ].filter(Boolean);
  if (settings?.flare === 'none') cinematic.push('restrained flare, no added decorative streaks');
  else if (settings?.flare || (settings?.flare !== null && lens?.flareColor)) {
    const color = lens?.flareColor === 'amber' ? 'amber' : lens?.flareColor === 'silver' ? 'neutral silver' : lens?.flareColor === 'blue' ? 'blue' : '';
    cinematic.push(`${settings?.flare === 'strong' ? 'pronounced' : 'subtle'} ${color} ${lens?.squeeze ? 'horizontal ' : ''}flares motivated by bright light sources, not fixed lines across the image`.replace(/ +/g, ' '));
  }
  const shutter = legacy?.shutterEffect ?? settings?.shutterEffect;
  return [...cinematic,
    legacy?.lens ? describeCameraLens(legacy.lens) : '',
    shutter ? SHUTTER_PROMPTS[shutter] : '',
    legacy?.aperture ? APERTURE_PROMPTS[legacy.aperture] : '',
    legacy?.exposureTime ? `${legacy.exposureTime} exposure time` : '',
  ].filter(Boolean).join(', ');
}

/**
 * cinematography — 回归测试：摄影设定。
 */
import { describe, expect, it } from 'vitest';
import { CINEMA_CAMERAS, CINEMA_EFFECTS, CINEMA_LENSES } from '../../src/data/cinematography';
import { buildGenerationCameraPrompt, cinemaMinT, cinematographyCompatibility, editableGenerationCinematography, resolveCinematography, supportsCinemaFocal } from '../../src/utils/cinematography';
import { buildShotFramePrompt, formatShotVideoPrompt, type ShotRow } from '../../src/types/shotlist';

describe('摄影设定', () => {
  it('视频摄影逐项覆盖分镜，保留未覆盖项并支持明确自动', () => {
    const defaults = { cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35, apertureT: 2.8 };
    const prompt = buildGenerationCameraPrompt({ cinematography: { cameraId: 'sony-venice-2', focalLengthMm: 50, apertureT: null } }, defaults);
    expect(prompt).toContain('SONY VENICE 2');
    expect(prompt).toContain('Cooke S4/i');
    expect(prompt).toContain('50mm focal length');
    expect(prompt).not.toMatch(/ARRI ALEXA|35mm|working aperture/);
    expect(defaults).toEqual({ cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35, apertureT: 2.8 });
  });

  it('视频新的明确自动和光学设置替换旧参数，不产生两套焦段、光圈和快门', () => {
    const prompt = buildGenerationCameraPrompt({ lens: '85mm', aperture: 'f/8', shutterEffect: 'freeze',
      cinematography: { lensId: 'laowa-proteus-blue', focalLengthMm: 35, apertureT: 2.8, shutterEffect: 'natural' } });
    expect(prompt).toContain('Laowa Proteus');
    expect(prompt).toContain('35mm focal length');
    expect(prompt).toContain('working aperture T2.8');
    expect(prompt).toContain('natural shutter motion rendering');
    expect(prompt).not.toMatch(/85mm|f\/8|crisp frozen/);
    expect(buildGenerationCameraPrompt({ lens: '85mm', aperture: 'f/8', shutterEffect: 'freeze',
      cinematography: { focalLengthMm: null, apertureT: null, shutterEffect: null } })).toBe('');
  });

  it('旧焦段、快门可编辑，f 值不伪装成 T 值，显式自动不被旧值复活', () => {
    const legacy = { lens: '35mm' as const, aperture: 'f/4' as const, shutterEffect: 'natural' as const };
    expect(editableGenerationCinematography(legacy)).toEqual({ focalLengthMm: 35, shutterEffect: 'natural' });
    expect(editableGenerationCinematography({ ...legacy, cinematography: { focalLengthMm: null, shutterEffect: null } }))
      .toEqual({ focalLengthMm: null, shutterEffect: null });
    expect(editableGenerationCinematography({ lens: 'macro', exposureTime: '1s' })).toBeUndefined();
    expect(legacy).toEqual({ lens: '35mm', aperture: 'f/4', shutterEffect: 'natural' });
  });

  it('逐项继承，显式自动不重新带入整表字段，输入保持不变', () => {
    const defaults = { cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35, apertureT: 2.8 };
    const override = { cameraId: undefined, focalLengthMm: 50, apertureT: null };
    expect(resolveCinematography(defaults, override)).toEqual({ ...defaults, focalLengthMm: 50, apertureT: null });
    expect(defaults.apertureT).toBe(2.8);
    expect(override).toEqual({ cameraId: undefined, focalLengthMm: 50, apertureT: null });
  });

  it('未设摄影时保持旧提示词，旧相机参数的文本格式不变', () => {
    expect(buildGenerationCameraPrompt()).toBe('');
    expect(buildGenerationCameraPrompt(undefined, {})).toBe('');
    expect(buildGenerationCameraPrompt({ lens: '35mm', aperture: 'f/4', shutterEffect: 'natural', exposureTime: '1/60s' }))
      .toBe('35mm cinematic lens, natural shutter motion rendering, f/4 aperture, balanced depth of field, 1/60s exposure time');
    const row: ShotRow = { id: 'one', shotNo: '1', content: '月台上的人物', camera: '推' };
    expect(buildShotFramePrompt(row)).toBe('推，月台上的人物');
    expect(buildShotFramePrompt({ ...row, content: '', camera: '' }, { cameraId: 'arri-alexa-35' })).toBe('');
  });

  it('节点显式光学参数覆盖分镜参数，防止编造不属于该系列的焦段', () => {
    const prompt = buildGenerationCameraPrompt({ lens: '85mm', aperture: 'f/8', shutterEffect: 'freeze' }, {
      cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35, apertureT: 2.8,
      depthOfField: 'shallow', shutterEffect: 'motion',
    });
    expect(prompt).toContain('ARRI ALEXA 35');
    expect(prompt).toContain('85mm portrait lens');
    expect(prompt).toContain('f/8 aperture, deep depth of field');
    expect(prompt).toContain('crisp frozen motion');
    expect(prompt).not.toMatch(/Cooke S4|35mm|T2.8|shallow depth|slow-shutter/);
  });

  it('变形镜头区分耀光颜色；显式克制耀光时不添加彩色光带', () => {
    const blue = buildGenerationCameraPrompt(undefined, { lensId: 'laowa-proteus-blue', focalLengthMm: 35 });
    const amber = buildGenerationCameraPrompt(undefined, { lensId: 'laowa-proteus-amber', focalLengthMm: 35 });
    expect(blue).toContain('2x anamorphic');
    expect(blue).toContain('blue horizontal flares motivated by bright light sources');
    expect(amber).toContain('amber horizontal flares');
    const none = buildGenerationCameraPrompt(undefined, { lensId: 'laowa-proteus-blue', flare: 'none' });
    expect(none).not.toContain('blue horizontal');
    expect(none).toContain('no added decorative streaks');
    expect(buildGenerationCameraPrompt(undefined, { lensId: 'laowa-proteus-blue', flare: null })).not.toContain('horizontal flares');
    expect(buildGenerationCameraPrompt(undefined, { lensId: 'laowa-argus-ff', apertureT: 1 })).not.toContain('horizontal');
  });

  it('胶片与数字模拟分开表达，并跳过非法数值和未知目录 ID', () => {
    expect(buildGenerationCameraPrompt(undefined, { cameraId: 'arri-arricam-lt', filmStockId: 'vision3-500t' })).toContain('film stock reference: KODAK VISION3 500T');
    expect(buildGenerationCameraPrompt(undefined, { cameraId: 'sony-venice-2', filmStockId: 'vision3-500t' })).toContain('film emulation reference: KODAK VISION3 500T');
    expect(buildGenerationCameraPrompt(undefined, { cameraId: 'unknown', lensId: 'unknown', focalLengthMm: NaN, apertureT: -1, focusDistanceM: Infinity })).toBe('');
  });

  it('按画幅、卡口及真实焦段给出提示，不用 FF 标签保证覆盖 VV', () => {
    expect(cinematographyCompatibility({ cameraId: 'red-vraptor-x-rf', lensId: 'laowa-proteus-blue' }).join(' ')).toMatch(/转接|Super 35/);
    expect(cinematographyCompatibility({ cameraId: 'red-vraptor-x-rf', lensId: 'laowa-argus-ff' })).toContain('大画幅模式需核对镜头像场，Full Frame 标记不保证覆盖全部窗口');
    expect(cinematographyCompatibility({ cameraId: 'arri-alexa-35', lensId: 'laowa-argus-ff' })).toContain('此卡口组合需进一步核对，可作为画面风格参考');
    const zoom = CINEMA_LENSES.find((item) => item.id === 'optimo-21-56')!;
    expect(supportsCinemaFocal(zoom, 42)).toBe(true);
    expect(supportsCinemaFocal(zoom, 85)).toBe(false);
    expect(cinemaMinT(CINEMA_LENSES.find((item) => item.id === 'cooke-panchro'), 100)).toBe(2.6);
  });

  it('所有预设引用真实目录、合法焦段和光圈；用途可供选择器展示', () => {
    for (const preset of CINEMA_EFFECTS) {
      const camera = CINEMA_CAMERAS.find((item) => item.id === preset.settings.cameraId)!;
      const lens = CINEMA_LENSES.find((item) => item.id === preset.settings.lensId)!;
      expect(camera.use).toBeTruthy();
      expect(lens.use).toBeTruthy();
      expect(supportsCinemaFocal(lens, preset.settings.focalLengthMm!)).toBe(true);
      expect(preset.settings.apertureT!).toBeGreaterThanOrEqual(cinemaMinT(lens, preset.settings.focalLengthMm));
    }
  });

  it('补图和单镜视频共用有效摄影设定，台词保留原文', () => {
    const row: ShotRow = { id: 'one', shotNo: '1', content: '人物走入车站', dialogue: '原台词 @drama{hero:主角}', cinematography: { focalLengthMm: 50 } };
    const defaults = { cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35 };
    for (const prompt of [buildShotFramePrompt(row, defaults), formatShotVideoPrompt(row, defaults)]) {
      expect(prompt).toContain('ARRI ALEXA 35');
      expect(prompt).toContain('50mm focal length');
      expect(prompt).not.toContain('35mm focal length');
    }
    expect(formatShotVideoPrompt(row, defaults)).toContain(row.dialogue);
  });
});

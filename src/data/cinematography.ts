/**
 * cinematography — 提供摄影机、镜头、效果与胶片的内置创作目录。
 */
import type { CinemaCamera, CinemaEffect, CinemaLens } from '../types/cinematography';

/** 常用焦段子集；用途是创作建议，覆盖按具体记录窗口复核。目录来源核对于 2026-10-30。 */
export const CINEMA_CAMERAS: readonly CinemaCamera[] = [
  { id: 'arri-alexa-35', name: 'ARRI ALEXA 35', capture: 'digital', formats: ['s35'], mount: 'LPL', adapters: ['PL'],
    use: '常用于剧情长片、高端短剧、人物与复杂光线场景', source: 'https://www.arri.com/en/camera-systems/cameras/alexa-35' },
  { id: 'arri-mini-lf', name: 'ARRI ALEXA Mini LF', capture: 'digital', formats: ['lf', 's35'], mount: 'LPL', adapters: ['PL'],
    use: '常用于大画幅剧情、广告、人物与环境关系的呈现', source: 'https://www.arri.com/en/camera-systems/cameras/alexa-mini-lf' },
  { id: 'sony-venice-2', name: 'SONY VENICE 2', capture: 'digital', formats: ['ff', 's35'], mount: 'PL', adapters: ['E'],
    use: '常用于电影、剧集、夜景及高反差灯光场景', source: 'https://pro.sony/en_CO/products/digital-cinema-cameras/venice2' },
  { id: 'sony-burano', name: 'SONY BURANO', capture: 'digital', formats: ['ff', 's35'], mount: 'PL', adapters: ['E'],
    use: '常用于小团队剧情、纪录片、手持与外景拍摄', source: 'https://pro.sony/en_JO/products/digital-cinema-cameras/burano' },
  { id: 'red-vraptor-x-rf', name: 'RED V-RAPTOR [X] VV · RF', capture: 'digital', formats: ['vv', 's35'], mount: 'RF', adapters: ['PL', 'EF'],
    use: '常用于动作、广告、特效与大画幅细节场景', source: 'https://www.reddigitalcinema.com/v-raptor-x-black' },
  { id: 'red-komodo-x-rf', name: 'RED KOMODO-X · RF', capture: 'digital', formats: ['s35'], mount: 'RF', adapters: ['PL', 'EF'],
    use: '常用于动作机位、车拍、运动跟拍与紧凑空间', source: 'https://www.reddigitalcinema.com/komodo-x' },
  { id: 'canon-c400', name: 'Canon EOS C400', capture: 'digital', formats: ['ff', 's35', 's16'], mount: 'RF', adapters: ['PL', 'EF'],
    use: '常用于独立剧情、纪录片、采访与多用途制作', source: 'https://www.canon-europe.com/cameras/eos-c400/' },
  { id: 'blackmagic-ursa-cine', name: 'Blackmagic URSA Cine 12K LF', capture: 'digital', formats: ['ff', 's35'], mount: 'PL', adapters: ['LPL', 'EF'],
    use: '常用于独立电影、广告、视效与后期重构图素材', source: 'https://www.blackmagicdesign.com/products/blackmagicursacine/' },
  { id: 'arri-arricam-lt', name: 'ARRICAM LT', capture: 'film', formats: ['s35'], mount: 'PL', adapters: [],
    use: '常用于35毫米胶片剧情、年代片与自然质感叙事', source: 'https://www.arrirental.com/en/cameras/analog-film' },
  { id: 'arri-416', name: 'ARRIFLEX 416', capture: 'film', formats: ['s16'], mount: 'PL', adapters: [],
    use: '常用于16毫米胶片、纪实、回忆与颗粒感段落', source: 'https://www.arrirental.com/en/cameras/analog-film' },
  { id: 'panavision-xl2', name: 'Panavision Millennium XL2', capture: 'film', formats: ['s35'], mount: 'PV', adapters: [],
    use: '常用于35毫米胶片长片与传统宽银幕制作', source: 'https://www.panavision.com/camera-and-optics/cameras/product-detail/pfxmxl-millennium-xl2' },
];

const arri = 'https://www.arri.com/en/cine-lenses';
const zeiss = 'https://www.zeiss.com/photonics-and-optics/en/cinematography/lenses/';
const proteus: Omit<CinemaLens, 'id' | 'name' | 'flareColor'> = {
  coverage: 's35', mounts: ['PL', 'EF'], focalLengths: [20, 28, 35, 45, 60, 85, 100], minT: 2, squeeze: 2,
  use: '常用于夜景霓虹、逆光、椭圆焦外与宽银幕场景', source: 'https://laowacine.com/product/laowa-proteus-2x-anamorphic-series/',
};
export const CINEMA_LENSES: readonly CinemaLens[] = [
  { id: 'cooke-s4', name: 'Cooke S4/i S35', coverage: 's35', mounts: ['PL'], focalLengths: [18, 25, 35, 50, 75, 100], minT: 2,
    look: 'gentle contrast, natural color and material texture',
    use: '常用于剧情、人像、自然肤色与布料材质', source: 'https://cookeoptics.com/lens/s4-i-prime/' },
  { id: 'cooke-s8-ff', name: 'Cooke S8/i FF', coverage: 'ff', mounts: ['PL', 'LPL'], focalLengths: [18, 25, 35, 50, 65, 75, 100], minT: 1.4,
    look: 'smooth tonal transitions, natural color and material texture',
    use: '常用于大画幅人物、广告、浅景深与柔和焦外', source: 'https://cookeoptics.com/lens/s8-i-ff/' },
  { id: 'arri-signature', name: 'ARRI Signature Prime', coverage: 'ff', mounts: ['LPL'], focalLengths: [18, 25, 35, 47, 58, 75, 95, 125], minT: 1.8,
    look: 'gentle focus transitions, natural texture and balanced contrast',
    use: '常用于人物、广告、自然层次与柔和焦外', source: `${arri}/signature-lenses/signature-primes-zooms/arri-signature-lenses-compatibility` },
  { id: 'arri-master-prime', name: 'ARRI/ZEISS Master Prime', coverage: 's35', mounts: ['PL'], focalLengths: [18, 25, 35, 50, 65, 75, 100], minT: 1.3,
    look: 'well-defined fine textures and controlled contrast',
    use: '常用于清晰写实、动作、特效及低耀光场景', source: 'https://www.arri.com/en/camera-systems/cine-lenses/master-prime-lenses/master-prime-lenses' },
  { id: 'zeiss-supreme', name: 'ZEISS Supreme Prime', coverage: 'ff', mounts: ['PL', 'LPL'], focalLengths: [18, 25, 35, 50, 65, 85, 100], minT: 1.5,
    look: 'gentle sharpness and natural fine texture',
    use: '常用于人物访谈、剧情、展品与自然清晰的质感', source: `${zeiss}supreme-prime-lenses.html` },
  { id: 'zeiss-radiance', name: 'ZEISS Supreme Prime Radiance', coverage: 'ff', mounts: ['PL', 'LPL'], focalLengths: [18, 25, 35, 50, 65, 85, 100], minT: 1.5,
    look: 'gentle sharpness and slightly warm color rendering',
    use: '常用于逆光、音乐影像及可控耀光的氛围场景', source: `${zeiss}supreme-prime-radiance-lenses.html` },
  { id: 'leitz-summilux-c', name: 'Leitz SUMMILUX-C', coverage: 's35', mounts: ['PL'], focalLengths: [18, 25, 35, 50, 65, 75, 100], minT: 1.4,
    look: 'subtle color gradation and well-defined fine texture',
    use: '常用于人物剧情、低照度与细腻色彩层次', source: 'https://www.leitz-cine.com/product/summilux-c' },
  { id: 'cooke-panchro', name: 'Cooke Panchro/i Classic S35', coverage: 's35', mounts: ['PL'], focalLengths: [18, 25, 32, 40, 50, 75, 100], minT: 2.2, minTByFocal: { 100: 2.6 },
    look: 'vintage optical character and gentle contrast',
    use: '常用于年代片、回忆段落与复古柔和的人像', source: 'https://cookeoptics.com/lens/panchro-classic-i-s35/' },
  { id: 'optimo-21-56', name: 'Angénieux Optimo Ultra Compact 21–56 FF', coverage: 'ff', mounts: ['PL'], focalLengths: [21, 24, 28, 35, 50, 56], zoom: [21, 56], minT: 2.9,
    use: '常用于连续变焦、空间展示与灵活调整构图', source: 'https://www.angenieux.com/lenses/optimo-ultra-compact/' },
  { id: 'optimo-37-102', name: 'Angénieux Optimo Ultra Compact 37–102 FF', coverage: 'ff', mounts: ['PL'], focalLengths: [37, 50, 65, 75, 85, 102], zoom: [37, 102], minT: 2.9,
    use: '常用于人物跟拍、连续变焦与中长焦构图', source: 'https://www.angenieux.com/lenses/optimo-ultra-compact/' },
  { id: 'cooke-anamorphic-ff', name: 'Cooke Anamorphic/i FF · 1.8×', coverage: 'ff', mounts: ['PL', 'LPL'], focalLengths: [32, 40, 50, 75, 100], minT: 2.3, squeeze: 1.8,
    use: '常用于宽银幕剧情、人物与环境及椭圆焦外', source: 'https://cookeoptics.com/lens/anamorphic-i-ff/' },
  { id: 'arri-master-anamorphic', name: 'ARRI Master Anamorphic · 2×', coverage: 's35', mounts: ['PL'], focalLengths: [35, 40, 50, 60, 75, 100], minT: 1.9, squeeze: 2,
    use: '常用于克制的宽银幕剧情、夜景与清晰人物', source: `${arri}/arri-zeiss-fujinon-lenses/master-anamorphics` },
  { id: 'atlas-orion', name: 'Atlas Orion · 2×', coverage: 's35', mounts: ['PL', 'EF'], focalLengths: [32, 40, 50, 65, 80, 100], minT: 2, squeeze: 2,
    use: '常用于风格化宽银幕、音乐影像与逆光氛围', source: 'https://atlaslensco.com/products/orion-series-anamorphic-lenses' },
  { ...proteus, id: 'laowa-proteus-blue', name: 'Laowa Proteus · 2× Blue', flareColor: 'blue' },
  { ...proteus, id: 'laowa-proteus-amber', name: 'Laowa Proteus · 2× Amber', flareColor: 'amber' },
  { ...proteus, id: 'laowa-proteus-silver', name: 'Laowa Proteus · 2× Silver', flareColor: 'silver' },
  { id: 'laowa-argus-ff', name: 'Laowa Argus T1 FF Cine', coverage: 'ff', mounts: ['RF', 'E', 'Z'], focalLengths: [28, 35, 45], minT: 1,
    use: '常用于人像近景、灯串背景与低照度浅景深', source: 'https://laowacine.com/product/laowa-argus-t1-cine-series-ff/' },
  { id: 'laowa-pro2be', name: 'Laowa Pro2be 24mm T8', coverage: 'ff', mounts: ['PL'], focalLengths: [24], minT: 8, macro: true,
    use: '常用于产品、食物、微观细节与探针穿行镜头', source: 'https://laowacine.com/product/laowa-24mm-t8-2x-macro-pro2be/' },
];

export const CINEMA_EFFECTS: readonly CinemaEffect[] = [
  { id: 'natural', name: '自然剧情', use: '适合日常对话、人物关系与自然环境', prompt: 'natural skin tones, gentle highlight transitions, realistic skin and fabric texture',
    settings: { cameraId: 'arri-alexa-35', lensId: 'cooke-s4', focalLengthMm: 35, apertureT: 2.8, depthOfField: 'balanced', focus: 'eyes', flare: 'subtle', filmStockId: null, grain: 'none' } },
  { id: 'clean', name: '清晰写实', use: '适合动作、展品、建筑与清楚交代细节', prompt: 'clear restrained detail, natural color, controlled contrast, no excessive sharpening',
    settings: { cameraId: 'sony-venice-2', lensId: 'zeiss-supreme', focalLengthMm: 35, apertureT: 4, depthOfField: 'deep', focus: null, flare: 'none', filmStockId: null, grain: 'none' } },
  { id: 'vintage', name: '复古胶片', use: '适合年代片、回忆、梦境与怀旧叙事', prompt: 'vintage cinematic texture, gentle contrast and soft highlight transitions',
    settings: { cameraId: 'arri-arricam-lt', lensId: 'cooke-panchro', focalLengthMm: 40, apertureT: 2.8, depthOfField: 'balanced', focus: 'eyes', flare: 'subtle', filmStockId: 'vision3-500t', grain: 'subtle' } },
  { id: 'anamorphic', name: '霓虹宽银幕', use: '适合夜景街道、霓虹、逆光与风格化空间', prompt: 'cinematic anamorphic visual character, preserve natural human proportions after desqueeze',
    settings: { cameraId: 'arri-alexa-35', lensId: 'laowa-proteus-blue', recordingFormat: 's35', focalLengthMm: 35, apertureT: 2.8, depthOfField: 'shallow', focus: 'eyes', flare: 'subtle', filmStockId: null, grain: 'none' } },
  { id: 'portrait', name: '人物浅景深', use: '适合人像近景、情绪特写与灯串背景', prompt: 'intimate character portrait, clear eyes and natural facial texture',
    settings: { cameraId: 'sony-venice-2', lensId: 'zeiss-supreme', focalLengthMm: 85, apertureT: 2, depthOfField: 'shallow', focus: 'eyes', flare: 'subtle', filmStockId: null, grain: 'none' } },
  { id: 'macro', name: '产品微距', use: '适合食物、首饰、道具纹理与微观空间', prompt: 'close-focus product cinematography, precise fine surface detail and controlled lighting',
    settings: { cameraId: 'blackmagic-ursa-cine', lensId: 'laowa-pro2be', focalLengthMm: 24, apertureT: 8, depthOfField: 'balanced', focus: 'foreground', flare: 'none', filmStockId: null, grain: 'none' } },
];

export const CINEMA_FILM_STOCKS = [
  { id: 'vision3-50d', name: 'KODAK VISION3 50D', use: '适合明亮日景与细腻颗粒', prompt: 'KODAK VISION3 50D' },
  { id: 'vision3-250d', name: 'KODAK VISION3 250D', use: '适合日景、外景与混合亮度', prompt: 'KODAK VISION3 250D' },
  { id: 'vision3-200t', name: 'KODAK VISION3 200T', use: '适合室内灯光与细腻层次', prompt: 'KODAK VISION3 200T' },
  { id: 'vision3-500t', name: 'KODAK VISION3 500T', use: '适合夜景、室内与低照度氛围', prompt: 'KODAK VISION3 500T' },
] as const;

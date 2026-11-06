/**
 * directorPrevisSchema — 限制并规范化 AI 镜头预演场景 JSON。
 */
import type {
  DirectorPrevisScene, PrevisCameraKeyframe, PrevisObject, PrevisObjectKeyframe,
  PrevisPrimitive, PrevisVector,
} from '../types/directorPrevis';

export const PREVIS_MAX_BYTES = 512 * 1024;
export const PREVIS_MAX_DURATION = 60;
const PRIMITIVES: readonly PrevisPrimitive[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'character'];

function fail(label: string): never { throw new Error(`预演场景数据无效：${label}`); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !keys.includes(key))) fail(`${label} 含未知字段`);
  return raw;
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(label);
  return value;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label);
  return value.trim();
}
function color(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail(label);
  return value.toLowerCase();
}
function vector(value: unknown, min: number, max: number, label: string): PrevisVector {
  if (!Array.isArray(value) || value.length !== 3) fail(label);
  return value.map((entry) => number(entry, min, max, label)) as PrevisVector;
}
function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(label);
  return value;
}
function ordered<T extends { time: number }>(frames: T[], duration: number, label: string): T[] {
  frames.forEach((frame, index) => {
    if (frame.time > duration || (index > 0 && frame.time <= frames[index - 1].time)) fail(`${label} 时间须严格递增且位于片长内`);
  });
  return frames;
}

export function normalizeDirectorPrevisScene(value: unknown): DirectorPrevisScene {
  const raw = record(value, ['schemaVersion', 'title', 'duration', 'aspectRatio', 'easing', 'background', 'groundColor', 'objects', 'camera'], '场景');
  if (raw.schemaVersion !== 1) fail('版本');
  const duration = number(raw.duration, 1, PREVIS_MAX_DURATION, '片长（1–60 秒）');
  if (typeof raw.aspectRatio !== 'string' || !['16:9', '9:16', '2.39:1'].includes(raw.aspectRatio)) fail('画幅');
  if (raw.easing !== 'linear' && raw.easing !== 'smooth') fail('缓动');
  let totalFrames = 0;
  const objects: PrevisObject[] = array(raw.objects, 128, '物体（最多 128 个）').map((value) => {
    const obj = record(value, ['id', 'name', 'primitive', 'position', 'rotation', 'size', 'color', 'keyframes'], '物体');
    const id = text(obj.id, 64, '物体 ID');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('物体 ID');
    if (!PRIMITIVES.includes(obj.primitive as PrevisPrimitive)) fail('几何类型');
    const keyframes = array(obj.keyframes ?? [], 64, '物体关键帧').map((value): PrevisObjectKeyframe => {
      const frame = record(value, ['time', 'position', 'rotation'], '物体关键帧');
      return { time: number(frame.time, 0, duration, '时间'), position: vector(frame.position, -500, 500, '位置'), rotation: vector(frame.rotation, -3600, 3600, '旋转') };
    });
    totalFrames += keyframes.length;
    if (totalFrames > 1024) fail('物体关键帧总数');
    return {
      id, name: text(obj.name, 100, '物体名称'), primitive: obj.primitive as PrevisPrimitive,
      position: vector(obj.position, -500, 500, '位置'), rotation: vector(obj.rotation, -3600, 3600, '旋转'),
      size: vector(obj.size, 0.01, 500, '尺寸'), color: color(obj.color, '物体颜色'), keyframes: ordered(keyframes, duration, '物体关键帧'),
    };
  });
  if (!objects.length || new Set(objects.map((obj) => obj.id)).size !== objects.length) fail('物体不能为空或重复 ID');
  const camera = record(raw.camera, ['keyframes'], '摄影机');
  const keyframes = array(camera.keyframes, 64, '摄影机关键帧').map((value): PrevisCameraKeyframe => {
    const frame = record(value, ['time', 'position', 'target', 'focalLength', 'roll'], '摄影机关键帧');
    const position = vector(frame.position, -500, 500, '摄影机位置');
    const target = vector(frame.target, -500, 500, '注视目标');
    if (Math.hypot(...position.map((v, i) => v - target[i])) < 0.01) fail('摄影机与注视目标重合');
    return { time: number(frame.time, 0, duration, '时间'), position, target, focalLength: number(frame.focalLength, 12, 200, '焦距（12–200 mm）'), roll: number(frame.roll ?? 0, -180, 180, '摄影机横滚') };
  });
  ordered(keyframes, duration, '摄影机关键帧');
  if (keyframes.length < 2 || keyframes[0].time !== 0 || keyframes.at(-1)?.time !== duration) fail('摄影机关键帧须覆盖完整片长');
  return {
    schemaVersion: 1, title: text(raw.title, 120, '标题'), duration,
    aspectRatio: raw.aspectRatio as DirectorPrevisScene['aspectRatio'], easing: raw.easing,
    background: color(raw.background, '背景'), groundColor: color(raw.groundColor, '地面'), objects, camera: { keyframes },
  };
}

export function parseDirectorPrevisJson(source: string): DirectorPrevisScene {
  if (new TextEncoder().encode(source).byteLength > PREVIS_MAX_BYTES) fail('场景超过大小上限');
  const json = source.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail('请让模型返回完整 JSON'); }
  return normalizeDirectorPrevisScene(value);
}

export function createDefaultPrevisScene(): DirectorPrevisScene {
  return normalizeDirectorPrevisScene({
    schemaVersion: 1, title: '走廊跟拍预演', duration: 8, aspectRatio: '16:9', easing: 'linear',
    background: '#202735', groundColor: '#697380',
    objects: [
      { id: 'wall-left', name: '左墙', primitive: 'box', position: [-2.5, 1.5, 0], rotation: [0, 0, 0], size: [0.2, 3, 16], color: '#8996a8', keyframes: [] },
      { id: 'wall-right', name: '右墙', primitive: 'box', position: [2.5, 1.5, 0], rotation: [0, 0, 0], size: [0.2, 3, 16], color: '#8996a8', keyframes: [] },
      { id: 'actor', name: '人物 A', primitive: 'character', position: [0, 0, 4], rotation: [0, 180, 0], size: [0.55, 1.75, 0.4], color: '#dd9b65', keyframes: [
        { time: 0, position: [0, 0, 4], rotation: [0, 180, 0] }, { time: 8, position: [0, 0, -4], rotation: [0, 180, 0] },
      ] },
    ],
    camera: { keyframes: [
      { time: 0, position: [0, 1.6, 7], target: [0, 1.2, 4], focalLength: 35, roll: 0 },
      { time: 5, position: [0, 1.6, 2], target: [0, 1.2, -1], focalLength: 35, roll: 0 },
      { time: 6.5, position: [1.7, 1.6, -2.5], target: [0, 1.2, -2.5], focalLength: 35, roll: 0 },
      { time: 8, position: [0, 1.6, -7], target: [0, 1.2, -4], focalLength: 50, roll: 0 },
    ] },
  });
}

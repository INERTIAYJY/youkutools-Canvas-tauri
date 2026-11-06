/**
 * directorPrevisSchema — 回归测试：cinematic previs scene contract。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPrevisScene, normalizeDirectorPrevisScene, parseDirectorPrevisJson, PREVIS_MAX_BYTES } from '../../src/services/directorPrevisSchema';

describe('cinematic previs scene contract', () => {
  it('accepts a complete moving subject and camera timeline, including fenced model JSON', () => {
    const scene = createDefaultPrevisScene();
    expect(parseDirectorPrevisJson(`\`\`\`json\n${JSON.stringify(scene)}\n\`\`\``)).toEqual(scene);
    expect(scene.objects.find((object) => object.primitive === 'character')?.keyframes).toHaveLength(2);
    expect(scene.camera.keyframes.at(-1)?.time).toBe(scene.duration);
  });

  it.each([
    ['untrusted executable field', (scene: Record<string, unknown>) => { scene.code = 'alert(1)'; }],
    ['remote asset', (scene: Record<string, unknown>) => { (scene.objects as Record<string, unknown>[])[0].url = 'https://example.com/a.glb'; }],
    ['unsupported primitive', (scene: Record<string, unknown>) => { (scene.objects as Record<string, unknown>[])[0].primitive = 'javascript'; }],
    ['too long', (scene: Record<string, unknown>) => { scene.duration = 61; }],
    ['non-finite number', (scene: Record<string, unknown>) => { scene.duration = Infinity; }],
    ['wrong version', (scene: Record<string, unknown>) => { scene.schemaVersion = 2; }],
    ['non-string aspect ratio', (scene: Record<string, unknown>) => { scene.aspectRatio = ['16:9']; }],
    ['empty objects', (scene: Record<string, unknown>) => { scene.objects = []; }],
    ['duplicate IDs', (scene: Record<string, unknown>) => { const objs = scene.objects as Record<string, unknown>[]; objs[1].id = objs[0].id; }],
    ['invalid size', (scene: Record<string, unknown>) => { (scene.objects as Record<string, unknown>[])[0].size = [0, 2, 3]; }],
    ['invalid color', (scene: Record<string, unknown>) => { scene.background = 'url(https://example.com)'; }],
    ['path as ID', (scene: Record<string, unknown>) => { (scene.objects as Record<string, unknown>[])[0].id = '../scene'; }],
  ])('rejects %s', (_name, mutate) => {
    const scene = structuredClone(createDefaultPrevisScene()) as unknown as Record<string, unknown>;
    mutate(scene);
    expect(() => normalizeDirectorPrevisScene(scene)).toThrow('预演场景数据无效');
  });

  it('rejects incomplete, duplicate, unordered or coincident camera frames', () => {
    const base = createDefaultPrevisScene();
    for (const frames of [
      base.camera.keyframes.slice(1), base.camera.keyframes.slice(0, -1),
      [base.camera.keyframes[0], base.camera.keyframes[0], base.camera.keyframes.at(-1)!],
      [...base.camera.keyframes].reverse(),
      base.camera.keyframes.map((frame) => ({ ...frame, target: frame.position })),
    ]) expect(() => normalizeDirectorPrevisScene({ ...base, camera: { keyframes: frames } })).toThrow();
  });

  it('rejects excessive response size and out-of-range object motion', () => {
    expect(() => parseDirectorPrevisJson(' '.repeat(PREVIS_MAX_BYTES + 1))).toThrow('大小上限');
    const scene = createDefaultPrevisScene();
    scene.objects[2].keyframes[1].time = scene.duration + 1;
    expect(() => normalizeDirectorPrevisScene(scene)).toThrow();
  });

  it('bounds object and keyframe counts', () => {
    const scene = createDefaultPrevisScene();
    scene.objects = Array.from({ length: 129 }, (_, i) => ({ ...scene.objects[0], id: `obj-${i}` }));
    expect(() => normalizeDirectorPrevisScene(scene)).toThrow();
    const other = createDefaultPrevisScene();
    other.camera.keyframes = Array.from({ length: 65 }, (_, i) => ({ ...other.camera.keyframes[0], time: i / 8 }));
    expect(() => normalizeDirectorPrevisScene(other)).toThrow();
  });
});

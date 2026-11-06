/**
 * useAudioSpectrum — 回归测试：audio spectrum lifecycle。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioSpectrum } from '../../src/hooks/useAudioSpectrum';

class FakeAudio extends EventTarget { paused = true; }
const disconnectSource = vi.fn();
const disconnectAnalyser = vi.fn();
const close = vi.fn(async () => {});
const resume = vi.fn(async () => {});
const read = vi.fn((bins: Float32Array) => { bins.fill(-90); bins[80] = -30; });
const contextFactory = vi.fn();
const sourceFactory = vi.fn();
const resizeDisconnect = vi.fn();
let documentTarget: EventTarget & { hidden: boolean };
let audio: FakeAudio;
let canvas: HTMLCanvasElement;
let draw: Record<string, ReturnType<typeof vi.fn>>;
let frames: Map<number, FrameRequestCallback>;
let controller: ReturnType<typeof createAudioSpectrum> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map(); let id = 0;
  documentTarget = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'rgb(100, 100, 100)' }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = resizeDisconnect; });
  resume.mockResolvedValue(undefined);
  sourceFactory.mockImplementation(() => ({ connect: vi.fn(), disconnect: disconnectSource }));
  contextFactory.mockImplementation(() => {});
  vi.stubGlobal('AudioContext', class {
    constructor() { contextFactory(); }
    state = 'suspended'; sampleRate = 48_000; destination = {};
    resume = resume; close = close;
    createMediaElementSource = sourceFactory;
    createAnalyser = () => ({ fftSize: 8192, frequencyBinCount: 4096, connect: vi.fn(), disconnect: disconnectAnalyser, getFloatFrequencyData: read });
  });
  draw = Object.fromEntries(['setTransform', 'clearRect', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'closePath', 'fill'].map((name) => [name, vi.fn()]));
  canvas = { width: 0, height: 0, getBoundingClientRect: () => ({ width: 640, height: 300 }), getContext: () => draw } as unknown as HTMLCanvasElement;
  audio = new FakeAudio();
});
afterEach(() => { controller?.dispose(); controller = undefined; vi.unstubAllGlobals(); });

function make() { controller = createAudioSpectrum(audio as unknown as HTMLAudioElement, canvas); return controller; }
function frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); }

describe('audio spectrum lifecycle', () => {
  it('creates a single graph lazily and reads actual FFT bins while playing', async () => {
    const spectrum = make();
    expect(sourceFactory).not.toHaveBeenCalled();
    expect(await spectrum.prepare()).toBe(true);
    expect(await spectrum.prepare()).toBe(true);
    expect(sourceFactory).toHaveBeenCalledOnce();
    audio.paused = false; audio.dispatchEvent(new Event('play')); frame();
    expect(read).toHaveBeenCalledOnce();
    expect(draw.lineTo.mock.calls.some(([, y]) => y > 18 && y < 100)).toBe(true);
    expect(frames.size).toBe(1);
  });
  it('does not animate paused or hidden audio and resumes drawing on visibility', async () => {
    await make().prepare(); frame(); expect(frames.size).toBe(0);
    audio.paused = false; audio.dispatchEvent(new Event('play')); frame();
    documentTarget.hidden = true; documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    documentTarget.hidden = false; documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(1);
    audio.paused = true; audio.dispatchEvent(new Event('pause'));
    expect(frames.size).toBe(0);
  });
  it('disconnects the graph, observer and listeners on disposal', async () => {
    const spectrum = make(); await spectrum.prepare(); spectrum.dispose(); controller = undefined;
    expect(disconnectSource).toHaveBeenCalledOnce(); expect(disconnectAnalyser).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce(); expect(resizeDisconnect).toHaveBeenCalledOnce();
    audio.dispatchEvent(new Event('play'));
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    expect(await spectrum.prepare()).toBe(false);
  });
  it('reports unavailable analysis without throwing when Web Audio is missing', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(await make().prepare()).toBe(false);
  });
  it('does not retry a graph that failed to resume and still closes it', async () => {
    resume.mockRejectedValue(new Error('unavailable'));
    const spectrum = make();
    expect(await spectrum.prepare()).toBe(false); expect(await spectrum.prepare()).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
    spectrum.dispose(); controller = undefined; expect(close).toHaveBeenCalledOnce();
  });
  it('ignores resume completion after disposal', async () => {
    let finish!: () => void;
    resume.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const spectrum = make(); const pending = spectrum.prepare();
    spectrum.dispose(); controller = undefined; finish();
    expect(await pending).toBe(false); expect(frames.size).toBe(0);
  });
});

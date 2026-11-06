/**
 * useAudioSpectrum — 分析音频频谱并管理分析器生命周期。
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** One controller owns one media element. Never reconnect a disposed element to a new context. */
export function createAudioSpectrum(audio: HTMLAudioElement, canvas: HTMLCanvasElement) {
  let context: AudioContext | undefined;
  let source: MediaElementAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let bins: Float32Array<ArrayBuffer> | undefined;
  let frame = 0;
  let disposed = false;
  let failed = false;
  const minDb = -100;
  const maxDb = -20;

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const w = width / ratio;
    const h = height / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const colors = getComputedStyle(canvas);
    const grid = colors.getPropertyValue('--theme-border').trim();
    const text = colors.getPropertyValue('--theme-text-muted').trim();
    const line = colors.getPropertyValue('--brand-light').trim();
    const fill = colors.getPropertyValue('--brand-alpha-15').trim();
    const left = 12;
    const right = Math.max(left + 1, w - 46);
    const top = 18;
    const bottom = Math.max(top + 1, h - 28);
    const maxHz = Math.min(20_000, (context?.sampleRate ?? 48_000) / 2);
    const xFor = (hz: number) => left + Math.log(hz / 20) / Math.log(maxHz / 20) * (right - left);
    const yFor = (db: number) => top + (maxDb - Math.max(minDb, Math.min(maxDb, db))) / (maxDb - minDb) * (bottom - top);
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let db = minDb; db <= maxDb; db += 20) {
      const y = yFor(db);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = text; ctx.fillText(`${db}`, right + 8, y + 4);
    }
    ctx.fillStyle = text;
    ctx.fillText('dB', right + 8, 10);
    ctx.textAlign = 'center';
    for (const hz of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000]) {
      if (hz > maxHz) continue;
      const x = xFor(hz);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, x, h - 8);
    }
    ctx.textAlign = 'start';
    ctx.setLineDash([]);
    if (!analyser || !bins || !context) return;
    analyser.getFloatFrequencyData(bins);
    // Logarithmic buckets retain narrow peaks instead of skipping FFT bins at high frequencies.
    const columns = Math.max(1, Math.min(700, Math.floor(right - left)));
    const binHz = context.sampleRate / analyser.fftSize;
    ctx.beginPath();
    for (let i = 0; i <= columns; i += 1) {
      const hz = 20 * (maxHz / 20) ** (i / columns);
      const nextHz = 20 * (maxHz / 20) ** (Math.min(i + 1, columns) / columns);
      const start = Math.max(1, Math.floor(hz / binHz));
      const end = Math.min(bins.length - 1, Math.max(start, Math.ceil(nextHz / binHz)));
      let peak = minDb;
      for (let bin = start; bin <= end; bin += 1) peak = Math.max(peak, bins[bin]);
      const x = left + i / columns * (right - left);
      const y = yFor(peak);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  };

  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const tick = () => {
    frame = 0;
    if (disposed || document.hidden || audio.paused || !analyser) return;
    draw();
    frame = requestAnimationFrame(tick);
  };
  const start = () => { stop(); if (!disposed && !document.hidden) frame = requestAnimationFrame(tick); };
  const visibility = () => { if (document.hidden) stop(); else { draw(); if (!audio.paused) start(); } };
  audio.addEventListener('play', start);
  audio.addEventListener('pause', stop);
  audio.addEventListener('ended', stop);
  document.addEventListener('visibilitychange', visibility);
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);
  draw();

  return {
    async prepare() {
      if (disposed || failed) return false;
      try {
        if (!context) {
          context = new AudioContext();
          analyser = context.createAnalyser();
          analyser.fftSize = 8192;
          analyser.minDecibels = minDb;
          analyser.maxDecibels = maxDb;
          analyser.smoothingTimeConstant = 0.8;
          bins = new Float32Array(analyser.frequencyBinCount);
          source = context.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(context.destination);
        }
        if (context.state === 'suspended') await context.resume();
        if (disposed) return false;
        start();
        return true;
      } catch {
        failed = true;
        return false;
      }
    },
    dispose() {
      disposed = true;
      stop();
      resize.disconnect();
      audio.removeEventListener('play', start);
      audio.removeEventListener('pause', stop);
      audio.removeEventListener('ended', stop);
      document.removeEventListener('visibilitychange', visibility);
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      bins = undefined;
    },
  };
}

export function useAudioSpectrum(
  audioRef: RefObject<HTMLAudioElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const controller = useRef<ReturnType<typeof createAudioSpectrum> | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (enabled && audio && canvas) {
      // Draw the scale while idle; the audio graph itself is still created on play.
      try { controller.current = createAudioSpectrum(audio, canvas); } catch { /* prepare reports unavailable */ }
    }
    return () => { controller.current?.dispose(); controller.current = null; };
  }, [audioRef, canvasRef, enabled]);
  return useCallback(async () => {
    if (!enabled) return true;
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return false;
    try {
      controller.current ??= createAudioSpectrum(audio, canvas);
      return await controller.current.prepare();
    } catch {
      return false;
    }
  }, [audioRef, canvasRef, enabled]);
}

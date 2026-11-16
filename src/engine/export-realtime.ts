import { engine } from './engine';
import { getDuration } from '../state/store';

/*
 * Fallback exporter for browsers without WebCodecs: plays the timeline in real time into the
 * preview canvas while a MediaRecorder captures the canvas stream plus the Web Audio mix.
 */

interface RecorderFormat {
  id: 'mp4' | 'webm';
  mime: string;
  ext: string;
}

const CANDIDATES: RecorderFormat[] = [
  { id: 'mp4', mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { id: 'mp4', mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { id: 'mp4', mime: 'video/mp4', ext: 'mp4' },
  { id: 'webm', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { id: 'webm', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { id: 'webm', mime: 'video/webm', ext: 'webm' },
];

export function recorderFormats(): RecorderFormat[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const out: RecorderFormat[] = [];
  for (const c of CANDIDATES) {
    if (out.some((o) => o.id === c.id)) continue;
    if (MediaRecorder.isTypeSupported(c.mime)) out.push(c);
  }
  return out;
}

export interface RealtimeExportOptions {
  format: RecorderFormat;
  shortSide: number;
  fps: number;
  monitor: boolean;
  signal: AbortSignal;
  onProgress: (fraction: number, time: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function exportRealtime(opts: RealtimeExportOptions): Promise<Blob> {
  const duration = getDuration();
  if (duration <= 0) throw new Error('Timeline is empty');
  const canvas = engine.canvasEl;
  if (!canvas) throw new Error('Preview canvas not ready');

  engine.pause();
  engine.ensureAudio();
  await engine.audio?.ctx.resume();

  engine.beginExport(opts.shortSide, opts.monitor, opts.fps);
  try {
    engine.seek(0);
    await engine.waitReady();

    const video = canvas.captureStream(opts.fps);
    const tracks: MediaStreamTrack[] = [...video.getVideoTracks()];
    if (engine.audio) tracks.push(...engine.audio.dest.stream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const pixels = canvas.width * canvas.height;
    const rec = new MediaRecorder(stream, {
      mimeType: opts.format.mime,
      videoBitsPerSecond: Math.round(Math.min(40e6, Math.max(4e6, pixels * opts.fps * 0.12))),
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

    rec.start(500);
    await sleep(60);

    const ended = new Promise<void>((resolve) => {
      engine.onEnded = resolve;
      opts.signal.addEventListener('abort', () => {
        engine.onEnded = null;
        engine.pause();
        resolve();
      });
    });
    const tick = setInterval(() => opts.onProgress(Math.min(1, engine.time / duration), engine.time), 100);
    engine.play();
    await ended;
    clearInterval(tick);

    await sleep(200);
    rec.stop();
    await stopped;
    video.getTracks().forEach((t) => t.stop());

    if (opts.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    opts.onProgress(1, duration);
    return new Blob(chunks, { type: opts.format.mime.split(';')[0] });
  } finally {
    engine.endExport();
  }
}

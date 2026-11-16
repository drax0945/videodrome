import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  VideoSampleSink,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type Quality,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import type { Clip, MediaItem, Track } from '../state/types';
import { useEditor } from '../state/store';
import { projectDuration } from '../state/timeline';
import { ASPECTS, clamp, fadeEnvelope } from '../lib/util';
import { engine } from './engine';
import { fontString, renderFrame, type FrameSource } from './render';
import { exportRealtime, recorderFormats } from './export-realtime';
import { ensureFontFace } from '../fonts';

/*
 * Frame-by-frame export with WebCodecs (via Mediabunny for demuxing/muxing):
 *   1. every output frame is rendered at its exact timestamp, with source video frames decoded
 *      to match — nothing is tied to a playback clock, so it runs as fast as the machine allows;
 *   2. audio is mixed offline in short windows with OfflineAudioContext and encoded alongside.
 * Browsers without WebCodecs fall back to the real-time MediaRecorder path.
 */

export type QualityId = 'standard' | 'high' | 'max';

const QUALITIES: Record<QualityId, Quality> = {
  standard: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  max: QUALITY_VERY_HIGH,
};

export interface ExportFormat {
  id: 'mp4' | 'webm';
  ext: string;
  mime: string;
  /** 'webcodecs' = fast frame-by-frame; 'realtime' = MediaRecorder fallback */
  engine: 'webcodecs' | 'realtime';
  videoCodec?: VideoCodec;
  audioCodec?: AudioCodec | null;
  /** MediaRecorder mime type (realtime only) */
  recorderMime?: string;
}

export function webCodecsAvailable() {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

const CODEC_LABEL: Partial<Record<VideoCodec | AudioCodec, string>> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
};
export const codecLabel = (c?: string | null) => (c ? (CODEC_LABEL[c as VideoCodec] ?? c.toUpperCase()) : '—');

/** Which containers/codecs this browser can produce at the given size. */
export async function getExportFormats(width: number, height: number): Promise<ExportFormat[]> {
  if (webCodecsAvailable()) {
    const out: ExportFormat[] = [];
    const [mp4v, webmv] = await Promise.all([
      getFirstEncodableVideoCodec(['avc', 'hevc', 'av1', 'vp9'], { width, height }),
      getFirstEncodableVideoCodec(['vp9', 'av1', 'vp8'], { width, height }),
    ]);
    const [mp4a, webma] = await Promise.all([
      getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }),
      getFirstEncodableAudioCodec(['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }),
    ]);
    if (mp4v) out.push({ id: 'mp4', ext: 'mp4', mime: 'video/mp4', engine: 'webcodecs', videoCodec: mp4v, audioCodec: mp4a });
    if (webmv) out.push({ id: 'webm', ext: 'webm', mime: 'video/webm', engine: 'webcodecs', videoCodec: webmv, audioCodec: webma });
    if (out.length) return out;
  }
  return recorderFormats().map((f) => ({
    id: f.id,
    ext: f.ext,
    mime: f.mime.split(';')[0],
    engine: 'realtime' as const,
    recorderMime: f.mime,
  }));
}

export interface ExportOptions {
  format: ExportFormat;
  shortSide: number;
  fps: number;
  quality: QualityId;
  /** realtime fallback only: hear the mix while recording */
  monitor: boolean;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}

export interface ExportProgress {
  fraction: number;
  time: number;
  /** output seconds rendered per wall-clock second */
  speed: number;
  /** the frame just rendered (webcodecs only) */
  canvas?: HTMLCanvasElement;
}

export function exportProject(opts: ExportOptions): Promise<Blob> {
  if (opts.format.engine === 'realtime') {
    const startedAt = performance.now();
    return exportRealtime({
      format: { id: opts.format.id, ext: opts.format.ext, mime: opts.format.recorderMime! },
      shortSide: opts.shortSide,
      fps: opts.fps,
      monitor: opts.monitor,
      signal: opts.signal,
      onProgress: (fraction, time) =>
        opts.onProgress({ fraction, time, speed: time / Math.max(0.001, (performance.now() - startedAt) / 1000) }),
    });
  }
  return exportWebCodecs(opts);
}

/* ───────────────────────── helpers ───────────────────────── */

const SAMPLE_RATE = 48000;
const AUDIO_WINDOW = 10; // seconds of audio mixed per OfflineAudioContext pass

const abortError = () => new DOMException('Export cancelled', 'AbortError');

/** Yield so React can paint progress; MessageChannel isn't throttled like timers in background tabs. */
function yieldToUi() {
  return new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

interface Snapshot {
  clips: Clip[];
  tracks: Map<string, Track>;
  trackList: Track[];
  media: Map<string, MediaItem>;
  background: string;
  W: number;
  H: number;
  duration: number;
}

function takeSnapshot(): Snapshot {
  const s = useEditor.getState();
  const { w, h } = ASPECTS[s.aspect];
  return {
    clips: s.clips,
    trackList: s.tracks,
    tracks: new Map(s.tracks.map((t) => [t.id, t])),
    media: new Map(s.media.map((m) => [m.id, m])),
    background: s.background,
    W: w,
    H: h,
    duration: projectDuration(s.clips),
  };
}

/* ───────────── video frame providers ───────────── */

interface FrameProvider {
  next(): Promise<FrameSource | undefined>;
  close(): void;
}

/** Decodes exactly the source frames a clip needs, in order, via WebCodecs. */
class DecodedFrames implements FrameProvider {
  private gen: AsyncGenerator<VideoSample | null, void, unknown>;
  private last: VideoSample | null = null;

  constructor(sink: VideoSampleSink, timestamps: number[]) {
    this.gen = sink.samplesAtTimestamps(timestamps);
  }

  async next() {
    const r = await this.gen.next();
    if (!r.done && r.value) {
      this.last?.close();
      this.last = r.value;
    }
    const s = this.last;
    if (!s) return undefined;
    return {
      width: s.displayWidth,
      height: s.displayHeight,
      draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => s.draw(ctx, x, y, w, h),
    };
  }

  close() {
    this.last?.close();
    this.last = null;
    void this.gen.return(undefined);
  }
}

/** Fallback for files WebCodecs can't decode: seek a <video> element to each frame. */
class SeekedFrames implements FrameProvider {
  private el = document.createElement('video');
  private i = 0;
  private ready: Promise<void>;

  constructor(
    url: string,
    private timestamps: number[],
  ) {
    this.el.muted = true;
    this.el.preload = 'auto';
    this.el.src = url;
    this.ready = new Promise((res) => {
      this.el.addEventListener('loadeddata', () => res(), { once: true });
      this.el.addEventListener('error', () => res(), { once: true });
    });
  }

  async next() {
    await this.ready;
    const t = this.timestamps[Math.min(this.i++, this.timestamps.length - 1)];
    if (Math.abs(this.el.currentTime - t) > 1e-3) {
      await new Promise<void>((res) => {
        const done = () => res();
        this.el.addEventListener('seeked', done, { once: true });
        setTimeout(done, 3000);
        this.el.currentTime = t;
      });
    }
    if (this.el.readyState < 2) return undefined;
    const el = this.el;
    return {
      width: el.videoWidth,
      height: el.videoHeight,
      draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => ctx.drawImage(el, x, y, w, h),
    };
  }

  close() {
    this.el.removeAttribute('src');
    this.el.load();
  }
}

/* ───────────── audio ───────────── */

interface AudioSourceEntry {
  sink: AudioBufferSink | null;
  /** whole-file decode, used when the demuxer can't read the file */
  full: AudioBuffer | null;
}

class Inputs {
  private inputs = new Map<string, Input>();
  private videoSinks = new Map<string, Promise<VideoSampleSink | null>>();
  private audio = new Map<string, Promise<AudioSourceEntry>>();

  private input(m: MediaItem) {
    let input = this.inputs.get(m.id);
    if (!input) {
      input = new Input({ source: new BlobSource(m.file), formats: ALL_FORMATS });
      this.inputs.set(m.id, input);
    }
    return input;
  }

  videoSink(m: MediaItem) {
    let p = this.videoSinks.get(m.id);
    if (!p) {
      p = (async () => {
        try {
          const track = await this.input(m).getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) return null;
          return new VideoSampleSink(track);
        } catch {
          return null;
        }
      })();
      this.videoSinks.set(m.id, p);
    }
    return p;
  }

  audioSource(m: MediaItem) {
    let p = this.audio.get(m.id);
    if (!p) {
      p = (async (): Promise<AudioSourceEntry> => {
        try {
          const track = await this.input(m).getPrimaryAudioTrack();
          if (track && (await track.canDecode())) return { sink: new AudioBufferSink(track), full: null };
          if (!track && m.kind === 'video') return { sink: null, full: null }; // silent video
        } catch {
          /* fall through to a full decode */
        }
        try {
          const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
          return { sink: null, full: await ctx.decodeAudioData(await m.file.arrayBuffer()) };
        } catch {
          return { sink: null, full: null };
        }
      })();
      this.audio.set(m.id, p);
    }
    return p;
  }

  dispose() {
    for (const i of this.inputs.values()) i.dispose();
    this.inputs.clear();
  }
}

function audibleClips(snap: Snapshot) {
  return snap.clips.filter((c) => {
    if (c.type !== 'audio' && c.type !== 'video') return false;
    const t = snap.tracks.get(c.trackId);
    if (!t || t.muted || c.muted || c.volume <= 0) return false;
    if (c.type === 'video' && t.hidden) return false;
    return !!c.mediaId && snap.media.has(c.mediaId);
  });
}

/** Mix timeline audio for samples [n0, n1) at SAMPLE_RATE. */
async function mixWindow(snap: Snapshot, clips: Clip[], inputs: Inputs, n0: number, n1: number) {
  const w0 = n0 / SAMPLE_RATE;
  const w1 = n1 / SAMPLE_RATE;
  const ctx = new OfflineAudioContext(2, n1 - n0, SAMPLE_RATE);

  for (const clip of clips) {
    const end = clip.start + clip.duration;
    if (end <= w0 || clip.start >= w1) continue;
    const src = await inputs.audioSource(snap.media.get(clip.mediaId!)!);
    if (!src.sink && !src.full) continue;

    // gain automation: volume × fades, piecewise-linear between these points
    const a = Math.max(w0, clip.start);
    const b = Math.min(w1, end);
    const env = (t: number) => clip.volume * fadeEnvelope(clip, t - clip.start);
    const gain = ctx.createGain();
    const pts = [a, clip.start + clip.fadeIn, end - clip.fadeOut, b].filter((p) => p >= a && p <= b).sort((x, y) => x - y);
    gain.gain.setValueAtTime(env(a), a - w0);
    for (const p of pts.slice(1)) gain.gain.linearRampToValueAtTime(env(p), p - w0);
    gain.connect(ctx.destination);

    const schedule = (buffer: AudioBuffer, bufferStart: number) => {
      // bufferStart: source-time of buffer[0]
      let when = clip.start + (bufferStart - clip.trimStart) / clip.speed - w0;
      let offset = 0;
      const minWhen = a - w0;
      if (when < minWhen) {
        offset = (minWhen - when) * clip.speed;
        when = minWhen;
      }
      if (offset >= buffer.duration) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = clip.speed;
      node.connect(gain);
      node.start(when, offset);
      node.stop(b - w0);
    };

    const srcA = clip.trimStart + (a - clip.start) * clip.speed;
    const srcB = clip.trimStart + (b - clip.start) * clip.speed;
    if (src.sink) {
      for await (const wrapped of src.sink.buffers(srcA, srcB)) schedule(wrapped.buffer, wrapped.timestamp);
    } else if (src.full) {
      schedule(src.full, 0);
    }
  }
  return ctx.startRendering();
}

/* ───────────────────────── main ───────────────────────── */

async function exportWebCodecs(opts: ExportOptions): Promise<Blob> {
  const snap = takeSnapshot();
  if (snap.duration <= 0) throw new Error('Timeline is empty');
  engine.pause();

  const k = opts.shortSide / Math.min(snap.W, snap.H);
  const canvas = document.createElement('canvas');
  canvas.width = even(snap.W * k);
  canvas.height = even(snap.H * k);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const rs = canvas.width / snap.W;

  // make sure stills and fonts are ready before the first frame
  await Promise.all(
    snap.clips.map(async (c) => {
      if (c.type === 'image' && c.mediaId) {
        const m = snap.media.get(c.mediaId);
        if (m) await engine.getImage(m).decode().catch(() => undefined);
      } else if (c.type === 'text' && c.text) {
        await ensureFontFace(c.text.font, fontString(c.text));
      }
    }),
  );

  const inputs = new Inputs();
  const audible = audibleClips(snap);
  const withAudio = audible.length > 0 && !!opts.format.audioCodec;

  const output = new Output({
    format: opts.format.id === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, {
    codec: opts.format.videoCodec!,
    quality: QUALITIES[opts.quality],
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(video, { frameRate: opts.fps });
  const audio = withAudio ? new AudioBufferSource({ codec: opts.format.audioCodec!, quality: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const providers = new Map<string, FrameProvider>();
  const videoClips = snap.clips.filter((c) => c.type === 'video' && c.mediaId && snap.media.has(c.mediaId));
  const totalFrames = Math.max(1, Math.ceil(snap.duration * opts.fps - 1e-6));
  const totalSamples = Math.round(snap.duration * SAMPLE_RATE);
  let audioSamples = 0;
  const startedAt = performance.now();
  let lastYield = startedAt;

  const openProvider = async (clip: Clip, fromFrame: number): Promise<FrameProvider> => {
    const m = snap.media.get(clip.mediaId!)!;
    const timestamps: number[] = [];
    const maxSrc = Math.max(0, m.duration - 1e-3);
    for (let j = fromFrame; j < totalFrames; j++) {
      const local = j / opts.fps - clip.start;
      if (local >= clip.duration) break;
      timestamps.push(clamp(clip.trimStart + local * clip.speed, 0, maxSrc));
    }
    const sink = await inputs.videoSink(m);
    return sink ? new DecodedFrames(sink, timestamps) : new SeekedFrames(m.url, timestamps);
  };

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal.aborted) throw abortError();
      const t = i / opts.fps;

      // keep the audio mix a window ahead of the video
      if (audio) {
        while (audioSamples < totalSamples && audioSamples / SAMPLE_RATE <= t + 1) {
          const n1 = Math.min(totalSamples, audioSamples + AUDIO_WINDOW * SAMPLE_RATE);
          await audio.add(await mixWindow(snap, audible, inputs, audioSamples, n1));
          audioSamples = n1;
        }
      }

      // open decoders for clips that just started, close the ones that ended
      for (const clip of videoClips) {
        const local = t - clip.start;
        const active = local >= 0 && local < clip.duration && !snap.tracks.get(clip.trackId)?.hidden;
        const open = providers.get(clip.id);
        if (active && !open) providers.set(clip.id, await openProvider(clip, i));
        else if (!active && open) {
          open.close();
          providers.delete(clip.id);
        }
      }

      const frames = new Map<string, FrameSource>();
      for (const [id, p] of providers) {
        const f = await p.next();
        if (f) frames.set(id, f);
      }

      renderFrame({
        ctx,
        W: snap.W,
        H: snap.H,
        rs,
        time: t,
        background: snap.background,
        tracks: snap.trackList,
        clips: snap.clips,
        media: snap.media,
        getVideoFrame: (c) => frames.get(c.id),
        getImage: engine.getImage,
        ensureFont: () => undefined,
      });
      await video.add(t, 1 / opts.fps);

      const now = performance.now();
      if (now - lastYield > 40 || i === totalFrames - 1) {
        lastYield = now;
        const elapsed = Math.max(0.001, (now - startedAt) / 1000);
        opts.onProgress({ fraction: (i + 1) / totalFrames, time: t, speed: (i + 1) / opts.fps / elapsed, canvas });
        await yieldToUi();
      }
    }

    if (audio) {
      while (audioSamples < totalSamples) {
        const n1 = Math.min(totalSamples, audioSamples + AUDIO_WINDOW * SAMPLE_RATE);
        await audio.add(await mixWindow(snap, audible, inputs, audioSamples, n1));
        audioSamples = n1;
      }
      audio.close();
    }
    video.close();
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Encoder produced no data');
    return new Blob([buffer], { type: opts.format.mime });
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    providers.forEach((p) => p.close());
    inputs.dispose();
  }
}
